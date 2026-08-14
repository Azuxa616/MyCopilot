import { describe, it, expect } from 'vitest';
import { truncateHistory, truncateWithStrategy, STRATEGIES } from '../truncator.js';
import { estimateMessagesTokens } from '../token-counter.js';
import type { Message, StrategyName } from '@my-copilot/shared';

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

// ---------------------------------------------------------------------------
// 多策略注册表（T5，RFC §2）。以下测试全部追加，不改动上方既有用例。
// ---------------------------------------------------------------------------

describe('STRATEGIES 注册表', () => {
  it('包含全部 5 种策略且每个条目的 name 与键一致', () => {
    expect(Object.keys(STRATEGIES).sort()).toEqual([
      'anchor',
      'head_tail',
      'importance',
      'sliding_window',
      'sliding_window_summary',
    ]);
    for (const [key, strategy] of Object.entries(STRATEGIES)) {
      expect(strategy.name).toBe(key);
      expect(typeof strategy.truncate).toBe('function');
    }
  });
});

describe('truncateWithStrategy — sliding_window', () => {
  it('10 条消息小预算下仅保留最新的可装下的链（happy path）', () => {
    // 10 条 big user 消息，每条自成一条链（≈604 tokens）。
    const history: Message[] = Array.from({ length: 10 }, (_, i) =>
      createMessage({ id: `m${i + 1}`, role: 'user', big: true }),
    );
    // 预算 = 2000（预留）+ 2×604 → 仅最后 2 条装得下。
    const result = truncateWithStrategy(history, 3208, 'sliding_window');

    expect(result.truncated.map((m) => m.id)).toEqual(['m9', 'm10']);
    expect(result.dropped).toBe(8);
  });

  it('预算内原样返回且保持引用不变（快速路径）', () => {
    const history: Message[] = [
      createMessage({ id: 'a' }),
      createMessage({ id: 'b' }),
    ];
    const result = truncateWithStrategy(history, 60000, 'sliding_window');

    expect(result.truncated).toBe(history);
    expect(result.dropped).toBe(0);
  });
});

describe('truncateWithStrategy — sliding_window_summary', () => {
  function buildHistory(): Message[] {
    return [
      createMessage({ id: 'sys1', role: 'system', content: 'S' }),
      ...Array.from({ length: 10 }, (_, i) =>
        createMessage({ id: `u${i + 1}`, role: 'user', big: true }),
      ),
    ];
  }

  it('传 summaryText 时在头部 system 之后注入合成摘要消息（happy path）', () => {
    const history = buildHistory();
    // 预算容纳 sys + 最后 2 条 user（2000 + 5 + 2×604 + 余量）。
    const result = truncateWithStrategy(history, 3263, 'sliding_window_summary', {
      summaryText: '用户询问了天气并收到答复。',
    });

    // dropped 计数与 sliding_window 一致。
    expect(result.dropped).toBe(8);
    expect(result.truncated).toHaveLength(4); // sys + 摘要 + 2 条尾部

    expect(result.truncated[0].id).toBe('sys1');
    const summary = result.truncated[1];
    expect(summary.role).toBe('assistant');
    expect(summary.content).toContain('[Previous conversation summary]');
    expect(summary.content).toContain('用户询问了天气并收到答复。');
    expect(summary.id).toMatch(/^syn-summary-/);
    expect(summary.sessionId).toBe('session-1'); // 沿用 history 首条 sessionId
    expect(summary.status).toBe('sent');
    expect(summary.attachments).toEqual([]);

    expect(result.truncated.slice(2).map((m) => m.id)).toEqual(['u9', 'u10']);
  });

  it('不传 summaryText 时结果与 sliding_window 完全一致', () => {
    const history = buildHistory();
    const sliding = truncateWithStrategy(history, 3263, 'sliding_window');
    const result = truncateWithStrategy(history, 3263, 'sliding_window_summary');

    expect(result).toEqual(sliding);
  });
});

describe('truncateWithStrategy — head_tail', () => {
  it('tailCount=3 时保留头部 system + 尾部 3 条，其余丢弃（happy path）', () => {
    const history: Message[] = [
      createMessage({ id: 'sys1', role: 'system', content: 'S' }),
      ...Array.from({ length: 10 }, (_, i) =>
        createMessage({ id: `u${i + 1}`, role: 'user', big: true }),
      ),
    ];
    const result = truncateWithStrategy(history, 2100, 'head_tail', {
      tailCount: 3,
    });

    expect(result.truncated.map((m) => m.id)).toEqual([
      'sys1',
      'u8',
      'u9',
      'u10',
    ]);
    expect(result.dropped).toBe(7);
  });

  it('尾部截断处切断 assistant-tool 链时向前扩展到链首', () => {
    const history: Message[] = [
      createMessage({ id: 'sys1', role: 'system', content: 'S' }),
      createMessage({ id: 'u0', role: 'user', big: true }),
      createMessage({
        id: 'asst',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'search', arguments: '{}' }],
      }),
      createMessage({
        id: 'tool-res',
        role: 'tool',
        content: '{"ok":true}',
        toolCallId: 'call_1',
      }),
      createMessage({ id: 'u1', role: 'user', content: 'thanks' }),
    ];
    // tailCount=2 → 尾部 [tool-res, u1]，截断点落在 tool 上 → 扩展纳入 asst。
    // 总 token ≈ 626 > 600 → 触发截断。
    const result = truncateWithStrategy(history, 600, 'head_tail', {
      tailCount: 2,
    });

    expect(result.truncated.map((m) => m.id)).toEqual([
      'sys1',
      'asst',
      'tool-res',
      'u1',
    ]);
    expect(result.dropped).toBe(1);
  });

  it('默认 tailCount=10', () => {
    // 12 条小 user 消息（≈6 tokens/条）总 token 77 > 30 → 触发截断。
    const history: Message[] = [
      createMessage({ id: 'sys1', role: 'system', content: 'S' }),
      ...Array.from({ length: 12 }, (_, i) =>
        createMessage({ id: `u${i + 1}`, role: 'user' }),
      ),
    ];
    const result = truncateWithStrategy(history, 30, 'head_tail');

    expect(result.truncated.map((m) => m.id)).toEqual([
      'sys1',
      ...Array.from({ length: 10 }, (_, i) => `u${i + 3}`),
    ]);
    expect(result.dropped).toBe(2);
  });
});

describe('truncateWithStrategy — anchor', () => {
  function buildHistory(): Message[] {
    // 10 条 big user 消息，每条自成一条链（≈604 tokens）。
    return Array.from({ length: 10 }, (_, i) =>
      createMessage({ id: `m${i + 1}`, role: 'user', big: true }),
    );
  }

  it('锚定第 2 条消息时即使超预算也保留该条（happy path）', () => {
    const history = buildHistory();
    // historyBudget = 2100 - 2000 = 100 < 604：任何链都装不下，
    // 但锚点链 m2 必须保留。
    const result = truncateWithStrategy(history, 2100, 'anchor', {
      anchorPredicate: (msg) => msg.id === 'm2',
    });

    expect(result.truncated.map((m) => m.id)).toEqual(['m2']);
    expect(result.dropped).toBe(9);
  });

  it('锚点链 + 尾部贪心：预算同时容纳锚点链与最新链', () => {
    const history = buildHistory();
    // historyBudget = 1208 = 锚点 m2 (604) + 最新 m10 (604)。
    const result = truncateWithStrategy(history, 3208, 'anchor', {
      anchorPredicate: (msg) => msg.id === 'm2',
    });

    expect(result.truncated.map((m) => m.id)).toEqual(['m2', 'm10']);
    expect(result.dropped).toBe(8);
  });

  it('无锚点（未提供谓词或谓词无命中）时退化为 sliding_window', () => {
    const history = buildHistory();
    const sliding = truncateWithStrategy(history, 2604, 'sliding_window');

    expect(truncateWithStrategy(history, 2604, 'anchor')).toEqual(sliding);
    expect(
      truncateWithStrategy(history, 2604, 'anchor', {
        anchorPredicate: () => false,
      }),
    ).toEqual(sliding);
  });
});

describe('truncateWithStrategy — importance', () => {
  function buildHistory(): Message[] {
    // 10 条消息：7 条 big user 填充 + 1 条 big user 关键提问 + 一对
    // assistant(toolCalls)→tool 小链。
    return [
      ...Array.from({ length: 7 }, (_, i) =>
        createMessage({ id: `f${i + 1}`, role: 'user', big: true }),
      ),
      createMessage({ id: 'u-key', role: 'user', big: true }),
      createMessage({
        id: 'asst-1',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'calc', arguments: '{}' }],
      }),
      createMessage({
        id: 'tool-1',
        role: 'tool',
        content: '{"r":1}',
        toolCallId: 'c1',
      }),
    ];
  }

  it('极小预算下 user 链优先于（更新的）tool 链存活（happy path）', () => {
    const history = buildHistory();
    // historyBudget = 604：u-key 链（3 分，604）优先装包；更靠后（更新）
    // 的 [asst-1, tool-1] 链（2 分，≈14 tokens）分数低，剩余预算归零后被跳过。
    const result = truncateWithStrategy(history, 2604, 'importance');

    expect(result.truncated.map((m) => m.id)).toEqual(['u-key']);
    expect(result.dropped).toBe(9);
  });

  it('同分按新旧装包，输出保持原时间顺序', () => {
    const history = buildHistory();
    // historyBudget = 1208：装入 u-key（3 分，最新）与 f7（3 分，次新），
    // 输出按原顺序 f7 → u-key。
    const result = truncateWithStrategy(history, 3208, 'importance');

    expect(result.truncated.map((m) => m.id)).toEqual(['f7', 'u-key']);
    expect(result.dropped).toBe(8);
  });

  it('roleWeights 可覆盖默认权重使 tool 链优先', () => {
    const history = buildHistory();
    // tool 权重提高到 5 → [asst-1, tool-1] 链得 5 分优先装包（≈14 tokens），
    // 剩余预算 590 装不下任何 604 的 user 链。
    const result = truncateWithStrategy(history, 2604, 'importance', {
      roleWeights: { tool: 5 },
    });

    expect(result.truncated.map((m) => m.id)).toEqual(['asst-1', 'tool-1']);
    expect(result.dropped).toBe(8);
  });
});

describe('truncateWithStrategy — 未知策略', () => {
  it('未知策略名抛出中文错误', () => {
    const history: Message[] = [createMessage({ id: 'a' })];
    expect(() =>
      truncateWithStrategy(history, 1000, 'bogus' as StrategyName),
    ).toThrow(/未知的截断策略/);
  });
});
