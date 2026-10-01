import { describe, it, expect, afterEach, vi } from 'vitest';
import { inflateSync } from 'node:zlib';
import type { Provider } from '@my-copilot/shared';
import {
  probeVisionByChat,
  buildSolidColorPng,
  pickProbeColor,
  PROBE_COLORS,
} from '../probe.js';
import { ProviderError } from '../../llm/index.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createProvider(over: Partial<Provider> = {}): Provider {
  return {
    id: 'p1',
    name: 'P',
    type: 'openai',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function createSSEResponse(lines: string[], status = 200): Response {
  const body = lines.join('\n') + '\n';
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } });
}

/** 固定色注入（probe 的 pickColor 可注入以保证测试确定性）。 */
const FIXED_COLOR = PROBE_COLORS.find((c) => c.en === 'teal')!;

function sseText(text: string): Response {
  const escaped = JSON.stringify(text).slice(1, -1);
  return createSSEResponse([
    `data: {"choices":[{"delta":{"content":"${escaped}"}}]}`,
    'data: [DONE]',
  ]);
}

describe('buildSolidColorPng（无依赖 PNG 编码）', () => {
  it('produces a valid 32×32 RGB PNG of the given color', () => {
    const png = buildSolidColorPng(FIXED_COLOR.rgb);
    // PNG 魔数
    expect(png[0]).toBe(0x89);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    // IHDR：宽高 = 32
    expect(png.readUInt32BE(16)).toBe(32);
    expect(png.readUInt32BE(20)).toBe(32);
    // 解 IDAT 验证像素：32 行 × (1 filter + 96 字节 RGB)
    const idatType = png.subarray(37, 41).toString('ascii');
    expect(idatType).toBe('IDAT');
    const raw = inflateSync(png.subarray(41, png.length - 16));
    expect(raw.length).toBe(32 * (1 + 32 * 3));
    for (let row = 0; row < 32; row++) {
      expect(raw[row * 97]).toBe(0); // filter = None
      for (let px = 0; px < 32; px++) {
        const o = row * 97 + 1 + px * 3;
        expect([raw[o], raw[o + 1], raw[o + 2]]).toEqual(FIXED_COLOR.rgb);
      }
    }
  });
});

describe('pickProbeColor', () => {
  it('returns a color from the uncommon palette（盲猜命中率≈0）', () => {
    for (let i = 0; i < 20; i++) {
      const c = pickProbeColor();
      expect(PROBE_COLORS).toContain(c);
      expect(c.synonyms.length).toBeGreaterThan(0);
    }
  });
});

describe('probeVisionByChat（判定 = 回答证明感知）', () => {
  it('回答命中颜色（中/英同义词）→ yes，且请求体携带纯色 PNG', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseText('这张图是 青色 (teal) 的纯色块。'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      probeVisionByChat(createProvider(), 'deepseek-flash', { pickColor: () => FIXED_COLOR }),
    ).resolves.toBe('yes');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    const body = JSON.parse(init.body as string) as {
      model: string;
      max_tokens: number;
      messages: Array<{
        role: string;
        content: Array<{ type: string; image_url?: { url: string }; text?: string }>;
      }>;
    };
    expect(body.model).toBe('deepseek-flash');
    expect(body.max_tokens).toBeLessThanOrEqual(512);
    const parts = body.messages[0]!.content;
    expect(parts.some((p) => p.type === 'text' && /颜色|color/i.test(p.text ?? ''))).toBe(true);
    const imagePart = parts.find((p) => p.type === 'image_url');
    expect(imagePart?.image_url?.url.startsWith('data:image/png;base64,')).toBe(true);
    // 图片字节即所选纯色
    const png = Buffer.from(
      imagePart!.image_url!.url.slice('data:image/png;base64,'.length),
      'base64',
    );
    const raw = inflateSync(png.subarray(41, png.length - 16));
    expect([raw[1], raw[2], raw[3]]).toEqual(FIXED_COLOR.rgb);
  });

  it('回答不命中（DeepSeek 降级占位语义："Unsupported Image"）→ no（根因回归锁定）', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      sseText('抱歉，图片显示为 "Unsupported Image"，我无法查看这张图片。'),
    ) as unknown as typeof fetch;

    await expect(
      probeVisionByChat(createProvider(), 'deepseek-v4-pro', { pickColor: () => FIXED_COLOR }),
    ).resolves.toBe('no');
  });

  it('盲猜常见色（red/blue）不命中不常见色板 → no', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(sseText('The color is red.')) as unknown as typeof fetch;

    await expect(
      probeVisionByChat(createProvider(), 'm', { pickColor: () => FIXED_COLOR }),
    ).resolves.toBe('no');
  });

  it('中文同义词命中（navy → 深蓝/藏青）→ yes', async () => {
    const navy = PROBE_COLORS.find((c) => c.en === 'navy')!;
    globalThis.fetch = vi.fn().mockResolvedValue(sseText('深蓝色')) as unknown as typeof fetch;

    await expect(
      probeVisionByChat(createProvider(), 'm', { pickColor: () => navy }),
    ).resolves.toBe('yes');
  });

  it('空流（无任何事件）→ ProviderError（不写库）', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(createSSEResponse([])) as unknown as typeof fetch;

    await expect(
      probeVisionByChat(createProvider(), 'm', { pickColor: () => FIXED_COLOR }),
    ).rejects.toThrow(ProviderError);
  });

  it('provider 400 仍上抛（端点侧分类为能力性 no）', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: 'Invalid content type. image_url is only supported by vision models.' },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const err = await probeVisionByChat(createProvider(), 'm', {
      pickColor: () => FIXED_COLOR,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).statusCode).toBe(400);
  });

  it('rejects non-openai providers (ollama 走 /api/show)', async () => {
    await expect(probeVisionByChat(createProvider({ type: 'ollama' }), 'llava:13b')).rejects.toThrow(
      /openai/,
    );
  });
});
