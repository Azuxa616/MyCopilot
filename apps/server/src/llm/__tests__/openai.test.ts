import { describe, it, expect, afterEach, vi } from 'vitest';
import { OpenAIAdapter } from '../openai.js';
import { ProviderError } from '../base.js';
import type { ChatMessage, AdapterConfig } from '../base.js';

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

async function collectGenerator(gen: AsyncGenerator<string, void, unknown>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
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
    const chunks = await collectGenerator(gen);

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
      collectGenerator(adapter.chatCompletionStream(messages, createConfig())),
    ).rejects.toThrow(ProviderError);

    try {
      for await (const _ of adapter.chatCompletionStream(messages, createConfig())) {
        // should throw before yielding
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

    const chunks: string[] = [];
    for await (const chunk of gen) {
      chunks.push(chunk);
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
    const chunks = await collectGenerator(gen);

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
    await collectGenerator(gen);

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
    await collectGenerator(gen);

    expect(capturedUrl).toBe('https://custom.api.com/v1/chat/completions');
  });
});
