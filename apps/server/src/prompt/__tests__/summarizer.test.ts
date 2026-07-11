import { describe, it, expect, vi } from 'vitest';
import type { StreamEvent } from '@my-copilot/shared';
import type {
  ProviderAdapter,
  AdapterConfig,
  ChatMessage,
} from '../../llm/base.js';
import { summarizeHistory } from '../summarizer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const adapterConfig: AdapterConfig = {
  baseUrl: 'http://localhost',
  apiKey: 'key',
  model: 'test-model',
};

/** Build an adapter whose `chatCompletionStream` yields the given events. */
function adapterFromEvents(
  events: StreamEvent[],
  capture?: (msgs: ChatMessage[]) => void,
): ProviderAdapter {
  return {
    type: 'openai',
    chatCompletionStream: (msgs: ChatMessage[]) => {
      capture?.(msgs);
      return (async function* () {
        for (const e of events) yield e;
      })();
    },
  };
}

/** Build an adapter whose `chatCompletionStream` throws on call. */
function throwingAdapter(err: unknown): ProviderAdapter {
  return {
    type: 'openai',
    chatCompletionStream: () => {
      return (async function* () {
        throw err;
      })();
    },
  };
}

function chatMsg(role: ChatMessage['role'], content: string): ChatMessage {
  return { role, content };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('summarizeHistory', () => {
  it('collects content chunks from the stream into a single summary', async () => {
    const adapter = adapterFromEvents([
      { type: 'content', text: 'The user ' },
      { type: 'content', text: 'asked about ' },
      { type: 'content', text: 'the weather.' },
      { type: 'finish', reason: 'stop' },
    ]);

    const result = await summarizeHistory({
      messages: [
        chatMsg('user', 'What is the weather?'),
        chatMsg('assistant', 'It is sunny.'),
      ],
      adapter,
      adapterConfig,
    });

    expect(result).not.toBeNull();
    expect(result!.summary).toBe('The user asked about the weather.');
    expect(result!.tokenCount).toBeGreaterThan(0);
  });

  it('prepends a system instruction message before the conversation', async () => {
    const captured: ChatMessage[] = [];
    const adapter = adapterFromEvents(
      [
        { type: 'content', text: 'summary' },
        { type: 'finish', reason: 'stop' },
      ],
      (msgs) => captured.push(...msgs),
    );

    await summarizeHistory({
      messages: [chatMsg('user', 'hi')],
      adapter,
      adapterConfig,
    });

    // First message must be the system instruction.
    expect(captured[0].role).toBe('system');
    expect(captured[0].content).toContain('Summarize');
    // Followed by the original messages in order.
    expect(captured[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('returns null when the stream produces empty content', async () => {
    const adapter = adapterFromEvents([
      { type: 'content', text: '   ' }, // whitespace only
      { type: 'finish', reason: 'stop' },
    ]);

    const result = await summarizeHistory({
      messages: [chatMsg('user', 'hello')],
      adapter,
      adapterConfig,
    });

    expect(result).toBeNull();
  });

  it('returns null (non-blocking) when the adapter throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = throwingAdapter(new Error('upstream down'));

    const result = await summarizeHistory({
      messages: [chatMsg('user', 'hello')],
      adapter,
      adapterConfig,
    });

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns null for empty message input without calling the adapter', async () => {
    const streamSpy = vi.fn();
    const adapter: ProviderAdapter = {
      type: 'openai',
      chatCompletionStream: (...args: unknown[]) => {
        streamSpy(...args);
        return (async function* () {
          yield { type: 'finish' as const, reason: 'stop' as const };
        })();
      },
    };

    const result = await summarizeHistory({
      messages: [],
      adapter,
      adapterConfig,
    });

    expect(result).toBeNull();
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('stops consuming the stream after the finish event', async () => {
    // After `finish`, no further content should be appended to the summary.
    const adapter: ProviderAdapter = {
      type: 'openai',
      chatCompletionStream: () => {
        return (async function* () {
          yield { type: 'content', text: 'before' };
          yield { type: 'finish', reason: 'stop' };
          // This arrives after finish — must NOT pollute the summary.
          yield { type: 'content', text: '-after' };
        })();
      },
    };

    const result = await summarizeHistory({
      messages: [chatMsg('user', 'hi')],
      adapter,
      adapterConfig,
    });

    expect(result!.summary).toBe('before');
  });
});
