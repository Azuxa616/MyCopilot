import { deflateSync } from 'node:zlib';
import type { Provider } from '@my-copilot/shared';
import { getAdapter, ProviderError } from '../llm/index.js';
import type { ChatMessage } from '../llm/index.js';

/**
 * 探测色板（刻意避开 red/blue/green 等盲猜高频色）：
 * 非视觉模型对"什么颜色"的默认臆测集中在常见色，命中不常见色板的概率≈0；
 * 真视觉模型在"要求精确色名"的提示下可稳定命名。synonyms 取宽（中英），
 * 降低真视觉模型的假阴性；generic 词（blue/red/紫）不入表——那是盲猜的领地。
 */
export interface ProbeColor {
  en: string;
  rgb: readonly [number, number, number];
  synonyms: readonly string[];
}

export const PROBE_COLORS: readonly ProbeColor[] = [
  { en: 'teal', rgb: [0, 128, 128], synonyms: ['teal', 'turquoise', '青色', '蓝绿色', '青绿色', '蓝绿'] },
  { en: 'maroon', rgb: [128, 0, 0], synonyms: ['maroon', '栗色', '褐红', '暗红', '深红', '棕红', 'brownish red'] },
  { en: 'olive', rgb: [128, 128, 0], synonyms: ['olive', '橄榄', '暗黄绿', 'olive green', '军绿'] },
  { en: 'lime', rgb: [0, 255, 0], synonyms: ['lime', '亮绿', '青柠', '荧光绿', '黄绿色', 'lime green', 'chartreuse'] },
  { en: 'fuchsia', rgb: [255, 0, 255], synonyms: ['fuchsia', 'magenta', '紫红', '品红', '玫红', '紫红色'] },
  { en: 'navy', rgb: [0, 0, 128], synonyms: ['navy', '深蓝', '藏青', 'dark blue', 'navy blue', '蓝黑'] },
  { en: 'silver', rgb: [192, 192, 192], synonyms: ['silver', '银色', '银灰', '浅灰', '灰色', 'gray', 'grey', 'light gray', 'light grey'] },
  { en: 'beige', rgb: [245, 222, 179], synonyms: ['beige', '米色', '米白', '卡其', 'khaki', 'tan'] },
];

/** 随机选一个探测色（可注入替换以保证测试确定性）。 */
export function pickProbeColor(): ProbeColor {
  return PROBE_COLORS[Math.floor(Math.random() * PROBE_COLORS.length)]!;
}

// ---------------------------------------------------------------------------
// 无依赖 PNG 编码（32×32 RGB 纯色）：IHDR + IDAT(zlib) + IEND，CRC32 查表
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** 生成 32×32 指定纯色的 RGB PNG（探测图片；像素内容是判定的 ground truth）。 */
export function buildSolidColorPng(rgb: readonly [number, number, number]): Buffer {
  const size = 32;
  const stride = 1 + size * 3; // filter byte + RGB 行
  const raw = Buffer.alloc(size * stride);
  for (let row = 0; row < size; row++) {
    const base = row * stride;
    raw[base] = 0; // filter = None
    for (let px = 0; px < size; px++) {
      const o = base + 1 + px * 3;
      raw[o] = rgb[0];
      raw[o + 1] = rgb[1];
      raw[o + 2] = rgb[2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type = RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// 探测：判定标准 = 回答证明感知（非"请求被接受"）
// ---------------------------------------------------------------------------

const PROBE_MAX_TOKENS = 256; // 容纳 reasoning 模型的前置思考 token
const PROBE_TIMEOUT_MS = 30_000;

const PROBE_PROMPT =
  '这张图片是什么纯色？只用一个精确的颜色词回答（例如 teal、深蓝）。' +
  ' What solid color is this image? Answer with ONE precise color word (e.g. "teal", "dark blue").';

/** 注入点（测试确定性）。 */
export interface ProbeIo {
  pickColor?: () => ProbeColor;
}

/**
 * 用纯色小图实测 vision 能力（设计 L4，openai 类型专用）。
 *
 * 判定标准（根因修复 2026-10-01，会话 290a7ec1 实证）：DeepSeek 对非 vision
 * 模型不返回 400，而是 200 + SSE 流 + 模型侧 "Unsupported Image" 占位降级——
 * "首个流事件"或"请求成功"都不构成图片被感知的证据。改为**答案验证**：
 * 随机不常见纯色 + 要求精确色名，回答命中同义词表 → yes；否则 → no
 * （盲猜高频色 red/blue/green 不在色板，臆测无法命中）。
 *
 * @returns 'yes' | 'no'
 * @throws ProviderError —— 空流/无文本（无法判定，不写库）或网络/上游错误
 *         （能力性 400 由端点 catch 分类为 no）
 */
export async function probeVisionByChat(
  provider: Provider,
  modelName: string,
  io: ProbeIo = {},
): Promise<'yes' | 'no'> {
  if (provider.type !== 'openai') {
    throw new Error('probeVisionByChat only supports openai-type providers (ollama 走 /api/show)');
  }

  const color = (io.pickColor ?? pickProbeColor)();
  const png = buildSolidColorPng(color.rgb);
  const imageDataUrl = `data:image/png;base64,${png.toString('base64')}`;

  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: PROBE_PROMPT,
      images: [{ url: imageDataUrl }],
    },
  ];

  const adapter = getAdapter(provider.type);
  let answer = '';
  for await (const event of adapter.chatCompletionStream(
    messages,
    { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: modelName },
    { maxTokens: PROBE_MAX_TOKENS, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
  )) {
    if (event.type === 'content') answer += event.text;
  }

  if (answer.trim().length === 0) {
    throw new ProviderError('探测响应无文本内容（无法判定）', 502);
  }

  const lower = answer.toLowerCase();
  const hit = color.synonyms.some((syn) => lower.includes(syn.toLowerCase()));
  return hit ? 'yes' : 'no';
}
