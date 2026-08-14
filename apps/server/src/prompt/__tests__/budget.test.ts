import { describe, it, expect } from 'vitest';
import type { Tool } from '@my-copilot/shared';
import { DEFAULT_BUDGET_CONFIG } from '@my-copilot/shared';
import type { ChatMessage } from '../../llm/base.js';
import {
  computeBudget,
  estimateTokenUsage,
  DEFAULT_TOTAL_CONTEXT_TOKENS,
} from '../budget.js';

/** 构造最小 Tool fixture，只让影响计量的字段可变。 */
function makeTool(partials: Partial<Tool> = {}): Tool {
  return {
    id: 'tool-1',
    name: 'calc',
    description: 'calculator',
    inputSchema: { fields: [] },
    type: 'built-in',
    safetyLevel: 'safe',
    sourceMcpId: null,
    policyVersion: 'v1',
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...partials,
  };
}

describe('computeBudget', () => {
  it('keeps five-bucket sum within total × (1 - headroomPct)', () => {
    // 五个功能桶之和不得超过总盘扣掉 headroom 后的可用额度
    const total = 100_000;
    const budget = computeBudget(total);
    const headroomPct = DEFAULT_BUDGET_CONFIG.headroomPct ?? 0;
    const fiveBucketSum =
      budget.system +
      budget.tools +
      budget.history +
      budget.toolOutputs +
      budget.working;

    expect(fiveBucketSum).toBeLessThanOrEqual(total * (1 - headroomPct));
    // headroom 按比例足额预留
    expect(budget.headroom).toBe(Math.floor(total * headroomPct));
  });

  it('allocates buckets proportionally to DEFAULT_BUDGET_CONFIG for 8000', () => {
    const budget = computeBudget(8000);
    // 各桶 = floor(8000 × pct)，期望值按默认比例逐桶写死
    expect(budget.system).toBe(480); // floor(8000 × 0.06)
    expect(budget.tools).toBe(1120); // floor(8000 × 0.14)
    expect(budget.history).toBe(2720); // floor(8000 × 0.34)
    expect(budget.toolOutputs).toBe(2240); // floor(8000 × 0.28)
    expect(budget.working).toBe(800); // floor(8000 × 0.10)
    expect(budget.headroom).toBe(640); // floor(8000 × 0.08)
    // total 字段回填原始总盘，而不是 floor 后的桶之和
    expect(budget.total).toBe(8000);

    // 每个桶都必须分到正数额度
    for (const value of [
      budget.system,
      budget.tools,
      budget.history,
      budget.toolOutputs,
      budget.working,
      budget.headroom,
    ]) {
      expect(value).toBeGreaterThan(0);
    }
  });

  it('supports field-level config overrides on top of defaults', () => {
    // 只覆盖两个字段，其余沿用默认配置
    const budget = computeBudget(1000, { systemPct: 0.1, headroomPct: 0.1 });
    expect(budget.system).toBe(100);
    expect(budget.headroom).toBe(100);
    expect(budget.tools).toBe(
      Math.floor(1000 * (DEFAULT_BUDGET_CONFIG.toolsPct ?? 0)),
    );
  });

  it('throws RangeError for zero or negative totals', () => {
    expect(() => computeBudget(-1)).toThrow(RangeError);
    expect(() => computeBudget(0)).toThrow(RangeError);
  });
});

describe('estimateTokenUsage', () => {
  it('returns all-zero usage for empty inputs', () => {
    const usage = estimateTokenUsage({
      messages: [],
      tools: [],
      systemPrompt: '',
    });
    expect(usage).toEqual({
      system: 0,
      tools: 0,
      history: 0,
      toolOutputs: 0,
      working: 0,
    });
  });

  it('counts each bucket with known-length fixtures', () => {
    // —— 已知长度 fixture，期望值全部手算（chars/4 向上取整，消息 +4 框架开销）——
    const systemPrompt = 'a'.repeat(40); // 10 tokens
    const skillsText = 'b'.repeat(60); // 15 tokens
    const tool = makeTool({
      name: 'calc',
      description: 'c'.repeat(80),
    });

    const messages: ChatMessage[] = [
      // system 角色消息不计入任何桶（system 桶以 systemPrompt + skillsText 为准）
      { role: 'system', content: 'z'.repeat(400) },
      // user：100 chars → 25 tokens + 4 开销 = 29
      { role: 'user', content: 'd'.repeat(100) },
      // 纯 tool-call 的 assistant：content 为 null → 仅 4 开销计入 history；
      // 内嵌 toolCalls 的 arguments '{"x":1}'（7 chars → 2 tokens）计入 toolOutputs
      {
        role: 'assistant',
        content: null,
        toolCalls: [{ id: 'call-1', name: 'calc', arguments: '{"x":1}' }],
      },
      // tool 结果：200 chars → 50 tokens + 4 开销 = 54，计入 toolOutputs
      { role: 'tool', content: 'e'.repeat(200), toolCallId: 'call-1' },
      // 普通 assistant：12 chars → 3 tokens + 4 开销 = 7，计入 history
      { role: 'assistant', content: 'f'.repeat(12) },
    ];

    const attachmentsText = 'g'.repeat(44); // 11 tokens
    const userContent = 'h'.repeat(8); // 2 tokens

    const usage = estimateTokenUsage({
      messages,
      tools: [tool],
      systemPrompt,
      skillsText,
      attachmentsText,
      userContent,
    });

    // system 桶 = systemPrompt(10) + skillsText(15)
    expect(usage.system).toBe(25);

    // tools 桶 = 仅序列化 name + description + inputSchema 三字段
    const expectedToolJson = JSON.stringify({
      name: 'calc',
      description: 'c'.repeat(80),
      inputSchema: { fields: [] },
    });
    expect(usage.tools).toBe(Math.ceil(expectedToolJson.length / 4));

    // history 桶 = 29 + 4 + 7（不含 tool 消息与 toolCalls arguments）
    expect(usage.history).toBe(40);

    // toolOutputs 桶 = arguments(2) + tool 消息(54)
    expect(usage.toolOutputs).toBe(56);

    // working 桶 = attachments(11) + userContent(2)
    expect(usage.working).toBe(13);
  });
});

describe('DEFAULT_TOTAL_CONTEXT_TOKENS', () => {
  it('defaults to a 128k window', () => {
    // 预算总盘默认值，调用方可按模型上下文窗口覆盖
    expect(DEFAULT_TOTAL_CONTEXT_TOKENS).toBe(128_000);
  });
});
