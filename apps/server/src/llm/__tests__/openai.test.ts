import { describe, it, expect, afterEach, vi } from 'vitest';
import { OpenAIAdapter } from '../openai.js';
import { ProviderError } from '../base.js';
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
});
