import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Provider } from '@my-copilot/shared';
import { probeVisionByChat, PROBE_IMAGE_DATA_URL } from '../probe.js';
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

describe('probeVisionByChat', () => {
  it('PROBE_IMAGE_DATA_URL is a valid tiny PNG data URL', () => {
    expect(PROBE_IMAGE_DATA_URL.startsWith('data:image/png;base64,')).toBe(true);
    const bytes = Buffer.from(PROBE_IMAGE_DATA_URL.slice('data:image/png;base64,'.length), 'base64');
    expect(bytes.length).toBeGreaterThanOrEqual(60); // 1×1 PNG ≈ 67–70 B
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG'); // PNG 魔数
    // ⚠️ 若本断言失败：用任意工具重生成一张 1×1 PNG 替换常量（探测只需 provider 接受 image block）
  });

  it('returns yes on the first stream event (provider accepted the image)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createSSEResponse([
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        'data: [DONE]',
      ]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(probeVisionByChat(createProvider(), 'deepseek-flash')).resolves.toBe('yes');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as {
      model: string;
      max_tokens: number;
      messages: Array<{
        role: string;
        content: Array<{ type: string; image_url?: { url: string } }>;
      }>;
    };
    expect(body.model).toBe('deepseek-flash');
    expect(body.max_tokens).toBe(64); // 小额输出，保证"几秒出结果"
    const parts = body.messages[0].content;
    expect(parts.some((p) => p.type === 'text')).toBe(true);
    const imagePart = parts.find((p) => p.type === 'image_url');
    expect(imagePart?.image_url?.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('throws ProviderError when the stream ends without any event (超时/中断)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(createSSEResponse([])) as unknown as typeof fetch;

    await expect(probeVisionByChat(createProvider(), 'm')).rejects.toThrow(ProviderError);
  });

  it('propagates provider errors (能力性 400 由端点分类)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: 'Invalid content type. image_url is only supported by vision models.' },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const err = await probeVisionByChat(createProvider(), 'deepseek-v4-pro').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).statusCode).toBe(400);
  });

  it('rejects non-openai providers (ollama 走 /api/show，chat 消息格式不支持 content array)', async () => {
    await expect(probeVisionByChat(createProvider({ type: 'ollama' }), 'llava:13b')).rejects.toThrow(
      /openai/,
    );
  });
});
