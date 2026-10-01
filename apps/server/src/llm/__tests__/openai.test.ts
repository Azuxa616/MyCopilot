import { describe, it, expect, afterEach, vi } from 'vitest';
import { OpenAIAdapter } from '../openai.js';
import { ProviderError } from '../base.js';
import { CAPABILITY_VISION_UNSUPPORTED } from '../../capability/classify.js';
import type { ChatMessage, AdapterConfig } from '../base.js';
import type { StreamEvent } from '@my-copilot/shared';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createConfig(overrides?: Partial<AdapterConfig>): AdapterConfig {
  return {
    baseUrl: 'https://api.openai.com',
    apiKey: 'sk-test',
    model: 'gpt-4',
    ...overrides,
  };
}

const messages: ChatMessage[] = [
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Hello' },
];

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

/** Collect all StreamEvents from the generator. */
async function collectEvents(gen: AsyncGenerator<StreamEvent, void, unknown>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/** Extract content text chunks from a StreamEvent list (preserves order). */
function contentTexts(events: StreamEvent[]): string[] {
  return events.filter((e) => e.type === 'content').map((e) => (e as { text: string }).text);
}

describe('OpenAIAdapter', () => {
  it('normal stream → yields correct chunks, stops on [DONE]', async () => {
    const sseLines = [
      'data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"index":0}]}',
      'data: {"id":"2","object":"chat.completion.chunk","choices":[{"delta":{"content":" world"},"index":0}]}',
      'data: [DONE]',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue(createSSEResponse(sseLines));

    const adapter = new OpenAIAdapter();
    const gen = adapter.chatCompletionStream(messages, createConfig());
    const chunks = contentTexts(await collectEvents(gen));

    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('HTTP 401 → ProviderError(statusCode=401)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const adapter = new OpenAIAdapter();

    await expect(
      collectEvents(adapter.chatCompletionStream(messages, createConfig())),
    ).rejects.toThrow(ProviderError);

    try {
      for await (const _chunk of adapter.chatCompletionStream(messages, createConfig())) {
        void _chunk;
        // should throw before yielding
        throw new Error('Should not reach here');
      }
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).statusCode).toBe(401);
    }
  });

  it('AbortSignal → generator ends gracefully (no throw)', async () => {
    // Create a controller and abort immediately
    const controller = new AbortController();
    controller.abort();

    globalThis.fetch = vi.fn().mockRejectedValue(
      new DOMException('The operation was aborted', 'AbortError'),
    );

    const adapter = new OpenAIAdapter();
    const gen = adapter.chatCompletionStream(messages, createConfig(), {
      signal: controller.signal,
    });

    const chunks: StreamEvent[] = [];
    for await (const event of gen) {
      chunks.push(event);
    }

    expect(chunks).toEqual([]);
  });

  it('skips lines without data: prefix', async () => {
    const sseLines = [
      ': keepalive',
      '',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: [DONE]',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue(createSSEResponse(sseLines));

    const adapter = new OpenAIAdapter();
    const gen = adapter.chatCompletionStream(messages, createConfig());
    const chunks = contentTexts(await collectEvents(gen));

    expect(chunks).toEqual(['Hello']);
  });

  it('normalizes baseUrl: strips trailing slash, adds /v1 path', async () => {
    const sseLines = ['data: [DONE]'];
    let capturedUrl = '';

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve(createSSEResponse(sseLines));
    });

    const adapter = new OpenAIAdapter();
    const config = createConfig({ baseUrl: 'https://custom.api.com/' });
    const gen = adapter.chatCompletionStream(messages, config);
    await collectEvents(gen);

    expect(capturedUrl).toBe('https://custom.api.com/v1/chat/completions');
  });

  it('does not double /v1 prefix', async () => {
    const sseLines = ['data: [DONE]'];
    let capturedUrl = '';

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve(createSSEResponse(sseLines));
    });

    const adapter = new OpenAIAdapter();
    const config = createConfig({ baseUrl: 'https://custom.api.com/v1' });
    const gen = adapter.chatCompletionStream(messages, config);
    await collectEvents(gen);

    expect(capturedUrl).toBe('https://custom.api.com/v1/chat/completions');
  });

  it('HTTP 400 capability error → ProviderError(errorCode=capability_vision_unsupported)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: 'Invalid content type. image_url is only supported by vision models.' },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = new OpenAIAdapter();
    try {
      for await (const _chunk of adapter.chatCompletionStream(messages, createConfig())) {
        void _chunk;
      }
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).statusCode).toBe(400);
      expect((err as ProviderError).errorCode).toBe(CAPABILITY_VISION_UNSUPPORTED);
    }
  });

  it('HTTP 429 → no capability errorCode (限流不反写)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'image requests rate limited' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const adapter = new OpenAIAdapter();
    try {
      for await (const _chunk of adapter.chatCompletionStream(messages, createConfig())) {
        void _chunk;
      }
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).statusCode).toBe(429);
      expect((err as ProviderError).errorCode).toBeUndefined();
    }
  });
});

describe('OpenAIAdapter multimodal serialization', () => {
  it('images → OpenAI content blocks（含 detail）', async () => {
    let captured: { messages: Array<Record<string, unknown>> } | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body)) as { messages: Array<Record<string, unknown>> };
      return createSSEResponse(['data: [DONE]']);
    });

    const adapter = new OpenAIAdapter();
    const multimodal: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      {
        role: 'user',
        content: '看图',
        images: [{ url: 'data:image/png;base64,AAA', detail: 'low' }],
      },
    ];
    await collectEvents(adapter.chatCompletionStream(multimodal, createConfig()));

    const userMsg = captured!.messages.find((m) => m.role === 'user')!;
    expect(Array.isArray(userMsg.content)).toBe(true);
    const blocks = userMsg.content as Array<Record<string, unknown>>;
    expect(blocks[0]).toEqual({ type: 'text', text: '看图' });
    expect(blocks[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAA', detail: 'low' },
    });
  });

  it('images 缺省 detail 时序列化体不含 detail 字段', async () => {
    let captured: { messages: Array<Record<string, unknown>> } | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body)) as { messages: Array<Record<string, unknown>> };
      return createSSEResponse(['data: [DONE]']);
    });

    const adapter = new OpenAIAdapter();
    const multimodal: ChatMessage[] = [
      { role: 'user', content: '', images: [{ url: 'data:image/png;base64,BBB' }] },
    ];
    await collectEvents(adapter.chatCompletionStream(multimodal, createConfig()));

    const userMsg = captured!.messages.find((m) => m.role === 'user')!;
    const blocks = userMsg.content as Array<Record<string, unknown>>;
    // 空 text 不产生 text block；仅一个 image block 且无 detail 键
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,BBB' } });
  });

  it('无 images 时 content 保持纯字符串（零回归）', async () => {
    let captured: { messages: Array<Record<string, unknown>> } | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body)) as { messages: Array<Record<string, unknown>> };
      return createSSEResponse(['data: [DONE]']);
    });

    const adapter = new OpenAIAdapter();
    await collectEvents(adapter.chatCompletionStream(messages, createConfig()));

    const userMsg = captured!.messages.find((m) => m.role === 'user')!;
    expect(userMsg.content).toBe('Hello');
  });
});
