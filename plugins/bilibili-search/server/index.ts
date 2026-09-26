/**
 * bilibili-search —— MCP stdio 服务（零依赖，Node 24+ 直接运行，无需编译安装）。
 *
 * 暴露一个工具：
 *   bilibili_search_videos(keyword, page?) —— 调用 B 站 web 端搜索接口，
 *   返回 markdown 视频卡片 + 结构化 JSON（type=bilibili-video，供未来卡片渲染器使用）。
 *
 * 协议：MCP stdio（换行分隔的 JSON-RPC 2.0）。本文件手写最小协议实现
 * （initialize / tools/list / tools/call / ping），不依赖 @modelcontextprotocol/sdk，
 * 使插件目录可以整体拷入 PLUGINS_DIR 即可用。
 *
 * B 站访问要点：
 *   - 搜索接口需要 wbi 签名（w_rid + wts），密钥取自 nav 接口的 wbi_img，按日轮换（内存缓存 12h）；
 *   - 需携带 buvid3/buvid4 cookie 以免风控（finger/spi 接口匿名可取，内存缓存 30 天）；
 *   - 需浏览器 UA 与 Referer。
 *
 * 注意：宿主以空 env 拉起本进程（transport-factory 传 env:config.env ?? {}），
 * 因此不得依赖任何环境变量。stdout 是协议通道，日志一律走 stderr。
 */
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

// ─── 常量 ────────────────────────────────────────────────────────────────────

const SERVER_NAME = 'bilibili-search';
const SERVER_VERSION = '0.1.0';
const TOOL_NAME = 'bilibili_search_videos';

/** 本服务能回应的协议版本（含最新与两个常见旧版）。 */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REFERER = 'https://www.bilibili.com/';

/** 单次外部请求超时。 */
const REQUEST_TIMEOUT_MS = 15_000;
/** wbi 密钥缓存时长（官方按日轮换，12h 足够安全）。 */
const WBI_KEY_TTL_MS = 12 * 60 * 60 * 1000;
/** buvid cookie 缓存时长。 */
const COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 返回给 agent 的最大卡片数（控制上下文体积）。 */
const MAX_CARDS = 10;

// ─── JSON-RPC / MCP 协议层 ───────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface ToolContent {
  type: 'text';
  text: string;
}

interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

/** 发送队列：串行化 stdout 写入，避免并发响应交错。 */
let writeChain: Promise<void> = Promise.resolve();

function sendMessage(msg: unknown): void {
  writeChain = writeChain.then(
    () =>
      new Promise<void>((resolve) => {
        process.stdout.write(`${JSON.stringify(msg)}\n`, () => resolve());
      }),
  );
}

function log(message: string): void {
  process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
}

async function dispatch(msg: JsonRpcRequest): Promise<unknown> {
  switch (msg.method) {
    case 'initialize':
      return handleInitialize(msg.params);
    case 'ping':
      return {};
    case 'tools/list':
      return {
        tools: [TOOL_DEFINITION],
      };
    case 'tools/call':
      return handleToolCall(msg.params);
    default:
      throw new JsonRpcError(-32601, `Method not found: ${msg.method}`);
  }
}

function handleInitialize(params: Record<string, unknown> | undefined): unknown {
  const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '';
  return {
    protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : SUPPORTED_PROTOCOL_VERSIONS[0],
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
  };
}

class JsonRpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const TOOL_DEFINITION = {
  name: TOOL_NAME,
  description:
    '搜索 B 站（bilibili.com）视频。返回带封面、链接、播放数据的视频卡片列表（markdown + JSON）。' +
    '适用于：用户想找某个主题的视频、查 UP 主的作品、让你推荐视频等场景。',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description: '搜索关键词（标题/标签/UP 主等，与 B 站网页搜索框一致）',
      },
      page: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: '页码，默认 1，每页约 20 条（工具最多返回前 10 张卡片）',
      },
    },
    required: ['keyword'],
    additionalProperties: false,
  },
};

async function handleToolCall(params: Record<string, unknown> | undefined): Promise<ToolResult> {
  const name = params?.name;
  if (name !== TOOL_NAME) {
    throw new JsonRpcError(-32602, `Unknown tool: ${String(name)}`);
  }

  const args = (params?.arguments ?? {}) as Record<string, unknown>;
  const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : '';
  if (!keyword) {
    return {
      content: [{ type: 'text', text: '参数错误：keyword 不能为空' }],
      isError: true,
    };
  }
  const rawPage = typeof args.page === 'number' ? args.page : 1;
  const page = Math.min(Math.max(Math.trunc(rawPage) || 1, 1), 50);

  try {
    const { total, cards } = await searchVideos(keyword, page);
    if (cards.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `关键词「${keyword}」（第 ${page} 页）没有搜到视频。可尝试更换关键词或减小范围。`,
          },
        ],
      };
    }
    const jsonPayload = JSON.stringify({ query: keyword, page, total, cards });
    return {
      content: [
        { type: 'text', text: toMarkdown(keyword, page, total, cards, jsonPayload) },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`search failed: ${message}`);
    return {
      content: [{ type: 'text', text: `搜索失败：${message}` }],
      isError: true,
    };
  }
}

// ─── B 站接口层 ──────────────────────────────────────────────────────────────

interface BiliEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

async function biliFetch(url: string, cookie?: string): Promise<Response> {
  return fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      referer: REFERER,
      accept: 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/** wbi 签名用的固定混淆表（社区广泛验证的官方算法）。 */
const MIXIN_KEY_ENC_TAB: readonly number[] = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

interface WbiKeys {
  imgKey: string;
  subKey: string;
  expiresAt: number;
}

let wbiKeysCache: WbiKeys | null = null;

/** 从 https://i0.hdslb.com/bfs/wbi/<key>.png 形式的 URL 中取密钥。 */
function extractKeyFromUrl(url: string): string {
  const filename = url.split('?')[0].split('/').pop() ?? '';
  return filename.replace(/\.[a-z0-9]+$/i, '');
}

async function getWbiKeys(): Promise<WbiKeys> {
  if (wbiKeysCache && wbiKeysCache.expiresAt > Date.now()) return wbiKeysCache;

  const res = await biliFetch('https://api.bilibili.com/x/web-interface/nav');
  if (!res.ok) throw new Error(`获取 wbi 密钥失败：HTTP ${res.status}`);
  const json = (await res.json()) as BiliEnvelope<{
    wbi_img?: { img_url?: string; sub_url?: string };
  }>;
  // 未登录时 code=-101，但 wbi_img 字段仍然返回，可直接使用。
  const imgUrl = json?.data?.wbi_img?.img_url;
  const subUrl = json?.data?.wbi_img?.sub_url;
  if (!imgUrl || !subUrl) {
    throw new Error(`获取 wbi 密钥失败：接口返回 code=${json?.code} ${json?.message ?? ''}`.trim());
  }
  wbiKeysCache = {
    imgKey: extractKeyFromUrl(imgUrl),
    subKey: extractKeyFromUrl(subUrl),
    expiresAt: Date.now() + WBI_KEY_TTL_MS,
  };
  return wbiKeysCache;
}

/** 对查询参数做 wbi 签名，返回带 wts/w_rid 的完整 query string。 */
function signWbi(params: Record<string, string>, imgKey: string, subKey: string): string {
  const rawKey = imgKey + subKey;
  const mixinKey = MIXIN_KEY_ENC_TAB.map((n) => rawKey[n]).join('').slice(0, 32);
  const merged: Record<string, string> = {
    ...params,
    wts: String(Math.round(Date.now() / 1000)),
  };
  const query = Object.keys(merged)
    .sort()
    .map((key) => {
      const value = merged[key].replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');
  const wRid = createHash('md5').update(query + mixinKey).digest('hex');
  return `${query}&w_rid=${wRid}`;
}

interface CookieInfo {
  value: string;
  expiresAt: number;
}

let cookieCache: CookieInfo | null = null;

/** 匿名获取 buvid3/buvid4，规避搜索接口的风控。 */
async function getBuvidCookie(): Promise<string> {
  if (cookieCache && cookieCache.expiresAt > Date.now()) return cookieCache.value;

  const res = await biliFetch('https://api.bilibili.com/x/frontend/finger/spi');
  if (!res.ok) throw new Error(`获取 buvid 失败：HTTP ${res.status}`);
  const json = (await res.json()) as BiliEnvelope<{ b_3?: string; b_4?: string }>;
  const b3 = json?.data?.b_3;
  const b4 = json?.data?.b_4;
  if (!b3 || !b4) {
    throw new Error(`获取 buvid 失败：接口返回 code=${json?.code} ${json?.message ?? ''}`.trim());
  }
  cookieCache = {
    value: `buvid3=${b3}; buvid4=${b4}`,
    expiresAt: Date.now() + COOKIE_TTL_MS,
  };
  return cookieCache.value;
}

// ─── 搜索与结果塑形 ──────────────────────────────────────────────────────────

interface VideoCard {
  type: 'bilibili-video';
  bvid: string;
  title: string;
  cover: string;
  author: string;
  play: number;
  danmaku: number;
  duration: string;
  pubdate: string;
  url: string;
}

interface RawSearchItem {
  type?: string;
  bvid?: string;
  title?: string;
  pic?: string;
  author?: string;
  play?: number;
  video_review?: number;
  duration?: string;
  pubdate?: number;
  description?: string;
}

/** 去掉标题里的 <em class="keyword"> 高亮标签。 */
function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}

/** //i2.hdslb.com/... → https://i2.hdslb.com/... */
function normalizeCover(pic: string): string {
  return pic.startsWith('//') ? `https:${pic}` : pic;
}

/** 规范时长：B 站对长视频返回 "189:9"（分:秒）形式，转为 "3:09:09"。 */
function normalizeDuration(raw: string): string {
  if (!raw) return raw;
  const parts = raw.split(':').map((p) => Number.parseInt(p, 10));
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n)) && parts[0] >= 60) {
    const hours = Math.floor(parts[0] / 60);
    const minutes = parts[0] % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(parts[1]).padStart(2, '0')}`;
  }
  return raw;
}

/** 播放数/弹幕数的中文短格式。 */
function formatCount(n: number): string {
  return n >= 10_000 ? `${(n / 10_000).toFixed(1)}万` : String(n);
}

async function searchVideos(
  keyword: string,
  page: number,
): Promise<{ total: number; cards: VideoCard[] }> {
  const [keys, cookie] = await Promise.all([getWbiKeys(), getBuvidCookie()]);
  const query = signWbi(
    { search_type: 'video', keyword, page: String(page) },
    keys.imgKey,
    keys.subKey,
  );
  const res = await biliFetch(
    `https://api.bilibili.com/x/web-interface/wbi/search/type?${query}`,
    cookie,
  );
  if (res.status === 412) {
    throw new Error('B 站风控拦截（HTTP 412），请稍后重试或减少搜索频率');
  }
  if (!res.ok) throw new Error(`B 站接口 HTTP ${res.status}`);
  const json = (await res.json()) as BiliEnvelope<{
    numResults?: number;
    result?: RawSearchItem[];
  }>;
  if (json.code !== 0) {
    throw new Error(`B 站接口错误 code=${json.code}：${json.message}`);
  }

  const items = (json.data?.result ?? []).filter(
    // 结果里偶尔混入广告等非 video 条目（其 type 为 'special' 等）。
    (item) => item.type === 'video' && typeof item.bvid === 'string',
  );
  const cards: VideoCard[] = items.slice(0, MAX_CARDS).map((item) => {
    const bvid = item.bvid ?? '';
    return {
      type: 'bilibili-video' as const,
      bvid,
      title: stripHtml(item.title ?? bvid),
      cover: normalizeCover(item.pic ?? ''),
      author: item.author ?? '',
      play: item.play ?? 0,
      danmaku: item.video_review ?? 0,
      duration: normalizeDuration(item.duration ?? ''),
      pubdate:
        typeof item.pubdate === 'number'
          ? new Date(item.pubdate * 1000).toISOString().slice(0, 10)
          : '',
      url: `https://www.bilibili.com/video/${bvid}`,
    };
  });
  return { total: json.data?.numResults ?? cards.length, cards };
}

/**
 * 输出给 agent 的 markdown：编号标题链接 + 元信息行，外加一个
 * ```bilibili-card {"cards":[…]}``` 围栏块（前端 MarkdownRenderer 会把该块
 * 渲染成视频卡片网格，agent 应原样保留进回复）。
 */
function toMarkdown(
  keyword: string,
  page: number,
  total: number,
  cards: VideoCard[],
  jsonPayload: string,
): string {
  const lines = cards.map((card, i) => {
    const stats = [
      `UP：${card.author}`,
      `播放 ${formatCount(card.play)}`,
      `弹幕 ${formatCount(card.danmaku)}`,
      `时长 ${card.duration}`,
      card.pubdate,
    ]
      .filter((s) => s.length > 0)
      .join(' · ');
    return `${i + 1}. [${card.title}](${card.url})\n${stats}`;
  });
  const header = `「${keyword}」的搜索结果（第 ${page} 页，约 ${formatCount(total)} 条）`;
  return [
    header,
    '',
    lines.join('\n\n'),
    '',
    '```bilibili-card',
    jsonPayload,
    '```',
  ].join('\n');
}

// ─── 主循环 ──────────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg: JsonRpcRequest;
  try {
    msg = JSON.parse(text) as JsonRpcRequest;
  } catch {
    log(`忽略无法解析的行：${text.slice(0, 120)}`);
    return;
  }
  // 通知（无 id）不需要回应。
  if (msg.id === undefined) return;

  dispatch(msg)
    .then((result) => {
      sendMessage({ jsonrpc: '2.0', id: msg.id, result });
    })
    .catch((err: unknown) => {
      const code = err instanceof JsonRpcError ? err.code : -32603;
      const message = err instanceof Error ? err.message : String(err);
      log(`request ${msg.method} failed: ${message}`);
      sendMessage({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code, message },
      });
    });
});

rl.on('close', () => {
  log('stdin closed, exiting');
  process.exit(0);
});

log(`${SERVER_NAME} MCP server started (pid ${process.pid})`);
