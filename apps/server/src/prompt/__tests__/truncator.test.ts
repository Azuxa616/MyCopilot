import { describe, it, expect } from 'vitest';
import { truncateHistory } from '../truncator.js';
import { estimateMessagesTokens } from '../token-counter.js';
import type { Message } from '@my-copilot/shared';

/**
 * Build a Message with sensible defaults. `content` defaults to a short string;
 * pass `big: true` for a ~600-token body so budget math is meaningful relative
 * to the 2000-token system reserve.
 */
function createMessage(overrides: Partial<Message> & { big?: boolean } = {}): Message {
  const { big, ...rest } = overrides;
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: big ? 'x'.repeat(2400) : 'hello', // big ≈ 604 tokens, small ≈ 5 tokens
    attachments: [],
    status: 'sent',
    createdAt: Date.now(),
    ...rest,
  };
}

describe('truncateHistory', () => {
  // Test 1: No truncation when under budget
  it('returns history unchanged when total tokens fit within budget', () => {
    const history: Message[] = [
      createMessage({ id: '1', role: 'user', content: 'Q1' }),
      createMessage({ id: '2', role: 'assistant', content: 'A1' }),
      createMessage({ id: '3', role: 'user', content: 'Q2' }),
    ];

    const total = estimateMessagesTokens(history);
    const result = truncateHistory({ history, maxTokens: total + 1000 });

    expect(result.truncated).toBe(history); // same reference (fast path)
    expect(result.dropped).toBe(0);
  });

  // Test 2: Truncation drops oldest messages first, keeps recent
  it('drops oldest chains and keeps the most recent ones within budget', () => {
    // 6 big user messages → each its own chain, ~604 tokens each.
    // Total ≈ 3624 tokens. Budget set so only the last 2 fit after reserve.
    const history: Message[] = Array.from({ length: 6 }, (_, i) =>
      createMessage({
        id: `m${i + 1}`,
        role: 'user',
        big: true,
        content: `message-${i + 1}-`.padEnd(2400, 'x'),
      }),
    );

    // Each chain cost ≈ 604. Keep last 2 chains → need ≥ 1208 history budget.
    // maxTokens = 2000 (reserve) + 1208 = 3208. Total 3624 > 3208 → truncates.
    const result = truncateHistory({ history, maxTokens: 3208 });

    // Last two messages kept, first four dropped.
    expect(result.dropped).toBe(4);
    expect(result.truncated).toHaveLength(2);
    expect(result.truncated[0].id).toBe('m5');
    expect(result.truncated[1].id).toBe('m6');
  });

  // Test 3: Tool chain (assistant + tool) is never split
  it('keeps an assistant tool-call turn and its tool result together', () => {
    // assistant(toolCalls) + tool must stay paired. Build a history where the
    // pair sits in the middle; budget forces some truncation but if the pair
    // is kept at all, both halves survive.
    const history: Message[] = [
      createMessage({ id: 'old1', role: 'user', big: true }),
      createMessage({ id: 'old2', role: 'assistant', big: true }),
      createMessage({
        id: 'asst-tool',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'get_weather', arguments: '{}' }],
      }),
      createMessage({
        id: 'tool-result',
        role: 'tool',
        content: '{"temp":20}',
        toolCallId: 'call_1',
      }),
      createMessage({ id: 'recent-user', role: 'user', content: 'Thanks!' }),
    ];

    // Generous budget keeps everything → pair obviously intact.
    const full = truncateHistory({
      history,
      maxTokens: estimateMessagesTokens(history) + 5000,
    });
    expect(full.dropped).toBe(0);
    const ids = full.truncated.map((m) => m.id);
    expect(ids).toContain('asst-tool');
    expect(ids).toContain('tool-result');

    // Tight budget: only the tail chain should fit. Whatever happens, the
    // assistant+tool pair is either both present or both absent.
    const tight = truncateHistory({ history, maxTokens: 2050 });
    const tightIds = new Set(tight.truncated.map((m) => m.id));
    expect(tightIds.has('asst-tool')).toBe(tightIds.has('tool-result'));
  });

  // Test 4: Leading system messages are always preserved
  it('preserves leading system messages even when the rest is truncated', () => {
    // 4 big user messages (≈604 tokens each) + 2 small system messages.
    // Total ≈ 2434 tokens, which exceeds maxTokens so truncation runs.
    const history: Message[] = [
      createMessage({ id: 'sys1', role: 'system', content: 'System instruction A' }),
      createMessage({ id: 'sys2', role: 'system', content: 'System instruction B' }),
      createMessage({ id: 'u1', role: 'user', big: true }),
      createMessage({ id: 'u2', role: 'user', big: true }),
      createMessage({ id: 'u3', role: 'user', big: true }),
      createMessage({ id: 'u4', role: 'user', big: true }),
    ];

    // Budget leaves only ~100 tokens for history after the system reserve —
    // not enough for any 604-token user chain, so all user chains get dropped
    // while system messages survive.
    const result = truncateHistory({ history, maxTokens: 2100 });

    const ids = result.truncated.map((m) => m.id);
    expect(ids).toContain('sys1');
    expect(ids).toContain('sys2');
    // System messages remain at the head.
    expect(result.truncated[0].id).toBe('sys1');
    expect(result.truncated[1].id).toBe('sys2');
    // And all user messages were dropped.
    expect(result.dropped).toBe(4);
    expect(ids).not.toContain('u1');
    expect(ids).not.toContain('u4');
  });

  // Test 5: Empty history returns empty result
  it('returns empty truncated and zero dropped for empty history', () => {
    const result = truncateHistory({ history: [], maxTokens: 60000 });
    expect(result.truncated).toEqual([]);
    expect(result.dropped).toBe(0);
  });

  // Test 6: Very small budget keeps only the most recent chain
  it('keeps only the most recent chain when budget is very tight', () => {
    // 5 big user messages, each ≈ 604 tokens (total ≈ 3020). Budget allows
    // just one chain after the system reserve: 2604 - 2000 = 604.
    const history: Message[] = Array.from({ length: 5 }, (_, i) =>
      createMessage({ id: `u${i + 1}`, role: 'user', big: true }),
    );
    const result = truncateHistory({ history, maxTokens: 2604 });

    expect(result.truncated).toHaveLength(1);
    expect(result.truncated[0].id).toBe('u5'); // most recent
    expect(result.dropped).toBe(4);
  });

  // Bonus: ensures the returned `dropped` count is consistent with the
  // difference between input and output lengths.
  it('dropped count equals history.length - truncated.length', () => {
    const history: Message[] = Array.from({ length: 5 }, (_, i) =>
      createMessage({ id: `m${i + 1}`, role: 'user', big: true }),
    );
    // 3020 total > 2800 → truncates, keeping only the most recent chain.
    const result = truncateHistory({ history, maxTokens: 2800 });

    expect(result.dropped).toBe(history.length - result.truncated.length);
    expect(result.truncated.length).toBeLessThan(history.length);
  });
});
