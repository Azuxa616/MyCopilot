import { describe, it, expect, afterEach, vi } from 'vitest';
import { OllamaAdapter } from '../ollama.js';
import { ProviderError } from '../base.js';
import type { ChatMessage, AdapterConfig } from '../base.js';
import type { StreamEvent } from '@my-copilot/shared';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createConfig(overrides?: Partial<AdapterConfig>): AdapterConfig {
  return {
    baseUrl: 'http://localhost:11434',
    model: 'llama3',
    ...overrides,
  };
}

const messages: ChatMessage[] = [
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Hello' },
];

function createNDJSONResponse(lines: string[], status = 200): Response {
  const body = lines.join('\n') + '\n';
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'application/x-ndjson' } });
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

describe('OllamaAdapter', () => {
  it('normal NDJSON stream → yields content', async () => {
    const ndjsonLines = [
      '{"model":"llama3","message":{"role":"assistant","content":"Hello"}}',
      '{"model":"llama3","message":{"role":"assistant","content":" world"}}',
      '{"model":"llama3","done":true}',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue(createNDJSONResponse(ndjsonLines));

    const adapter = new OllamaAdapter();
    const gen = adapter.chatCompletionStream(messages, createConfig());
    const chunks = contentTexts(await collectEvents(gen));

    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('done:true → stops', async () => {
    const ndjsonLines = [
      '{"model":"llama3","message":{"role":"assistant","content":"Hi"}}',
      '{"model":"llama3","done":true}',
      '{"model":"llama3","message":{"role":"assistant","content":"SHOULD NOT YIELD"}}',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue(createNDJSONResponse(ndjsonLines));

    const adapter = new OllamaAdapter();
    const gen = adapter.chatCompletionStream(messages, createConfig());
    const chunks = contentTexts(await collectEvents(gen));

    expect(chunks).toEqual(['Hi']);
  });

  it('HTTP error → ProviderError', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'model not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const adapter = new OllamaAdapter();

    try {
      for await (const _ of adapter.chatCompletionStream(messages, createConfig())) {
        // should throw before yielding
      }
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).statusCode).toBe(404);
    }
  });

  it('AbortSignal → generator ends gracefully (no throw)', async () => {
    const controller = new AbortController();
    controller.abort();

    globalThis.fetch = vi.fn().mockRejectedValue(
      new DOMException('The operation was aborted', 'AbortError'),
    );

    const adapter = new OllamaAdapter();
    const gen = adapter.chatCompletionStream(messages, createConfig(), {
      signal: controller.signal,
    });

    const chunks: StreamEvent[] = [];
    for await (const event of gen) {
      chunks.push(event);
    }

    expect(chunks).toEqual([]);
  });

  it('omits empty lines', async () => {
    const ndjsonLines = [
      '',
      '{"model":"llama3","message":{"role":"assistant","content":"Hi"}}',
      '',
      '{"model":"llama3","done":true}',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue(createNDJSONResponse(ndjsonLines));

    const adapter = new OllamaAdapter();
    const gen = adapter.chatCompletionStream(messages, createConfig());
    const chunks = contentTexts(await collectEvents(gen));

    expect(chunks).toEqual(['Hi']);
  });
});
