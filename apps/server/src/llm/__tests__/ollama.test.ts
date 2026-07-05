import { describe, it, expect, afterEach, vi } from 'vitest';
import { OllamaAdapter } from '../ollama.js';
import { ProviderError } from '../base.js';
import type { ChatMessage, AdapterConfig } from '../base.js';

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

async function collectGenerator(gen: AsyncGenerator<string, void, unknown>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
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
    const chunks = await collectGenerator(gen);

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
    const chunks = await collectGenerator(gen);

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

    const chunks: string[] = [];
    for await (const chunk of gen) {
      chunks.push(chunk);
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
    const chunks = await collectGenerator(gen);

    expect(chunks).toEqual(['Hi']);
  });
});
