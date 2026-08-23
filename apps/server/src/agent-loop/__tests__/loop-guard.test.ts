import { describe, it, expect } from 'vitest';
import type { LoopGuardCheckInput } from '../loop-guard.js';
import { createLoopGuard, digestToolCall } from '../loop-guard.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(
  overrides: Partial<LoopGuardCheckInput> = {},
): LoopGuardCheckInput {
  return {
    iterations: 0,
    historyTokens: 0,
    abortSignal: new AbortController().signal,
    attemptedDigests: new Set<string>(),
    ...overrides,
  };
}

function abortedSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

const HEX_64 = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// check：步数上限 / 用户中断 / token 预算
// ---------------------------------------------------------------------------

describe('LoopGuard check', () => {
  it('iterations 低于 maxSteps 时不停止', () => {
    const guard = createLoopGuard();
    const result = guard.check(makeInput({ iterations: 9 }));
    expect(result).toEqual({ stop: false });
    expect(result.reason).toBeUndefined();
  });

  it('iterations 达到 maxSteps（默认 10）→ max_steps', () => {
    const guard = createLoopGuard();
    expect(guard.check(makeInput({ iterations: 10 }))).toEqual({
      stop: true,
      reason: 'max_steps',
    });
  });

  it('abortSignal 已中止 → user_interrupt', () => {
    const guard = createLoopGuard();
    expect(guard.check(makeInput({ abortSignal: abortedSignal() }))).toEqual({
      stop: true,
      reason: 'user_interrupt',
    });
  });

  it('historyTokens 严格超过 tokenBudgetThreshold → max_tokens', () => {
    const guard = createLoopGuard({ tokenBudgetThreshold: 1000 });
    expect(guard.check(makeInput({ historyTokens: 1001 }))).toEqual({
      stop: true,
      reason: 'max_tokens',
    });
    // 恰好等于阈值不算超过
    expect(guard.check(makeInput({ historyTokens: 1000 }))).toEqual({
      stop: false,
    });
  });

  it('未配置 tokenBudgetThreshold 时 token 数不影响结果', () => {
    const guard = createLoopGuard();
    expect(guard.check(makeInput({ historyTokens: 1_000_000 }))).toEqual({
      stop: false,
    });
  });

  it('优先级：user_interrupt > max_steps > max_tokens（逐一断言）', () => {
    // 三条件同时满足 → user_interrupt 最高
    const guard = createLoopGuard({ tokenBudgetThreshold: 1000 });
    expect(
      guard.check(
        makeInput({
          iterations: 10,
          historyTokens: 1001,
          abortSignal: abortedSignal(),
        }),
      ),
    ).toEqual({ stop: true, reason: 'user_interrupt' });

    // 去掉中断，步数与预算同时越限 → max_steps 次之
    expect(
      guard.check(makeInput({ iterations: 10, historyTokens: 1001 })),
    ).toEqual({ stop: true, reason: 'max_steps' });

    // 步数未越限、仅预算越限 → max_tokens 最后
    expect(
      guard.check(makeInput({ iterations: 9, historyTokens: 1001 })),
    ).toEqual({ stop: true, reason: 'max_tokens' });
  });
});

// ---------------------------------------------------------------------------
// digestToolCall：含工具名的重复检测（bug 回归）
// ---------------------------------------------------------------------------

describe('digestToolCall 重复检测', () => {
  it('回归：不同工具同参数不判重——markAttempted(a) 后 hasAttempted(b) 为 false', () => {
    const guard = createLoopGuard();
    expect(guard.markAttempted('tool_a', '{}')).toBe(true);
    // 旧 bug（digest 不含工具名）下此处会是 true
    expect(guard.hasAttempted('tool_b', '{}')).toBe(false);
  });

  it('同工具同参数判重：markAttempted 二次返回 false', () => {
    const guard = createLoopGuard();
    expect(guard.markAttempted('tool_a', '{"q":1}')).toBe(true);
    expect(guard.hasAttempted('tool_a', '{"q":1}')).toBe(true);
    expect(guard.markAttempted('tool_a', '{"q":1}')).toBe(false);
  });

  it('digest 输出含工具名：不同工具同参数 digest 不同，同工具同参数相同', () => {
    expect(digestToolCall('a', '{}')).not.toBe(digestToolCall('b', '{}'));
    expect(digestToolCall('a', '{"x":1}')).toBe(digestToolCall('a', '{"x":1}'));
  });

  it('键顺序不同但语义相同的参数得到相同 digest（稳定序列化）', () => {
    expect(digestToolCall('a', '{"x":1,"y":2}')).toBe(
      digestToolCall('a', '{"y":2,"x":1}'),
    );
  });

  it('digest 为 64 位十六进制字符串', () => {
    expect(digestToolCall('a', '{}')).toMatch(HEX_64);
  });

  it('参数非法 JSON 时 digest 退化不抛错，且仍含工具名', () => {
    expect(() => digestToolCall('t', 'not-json')).not.toThrow();
    expect(digestToolCall('t', 'not-json')).toMatch(HEX_64);
    // 退化路径同样区分工具名
    expect(digestToolCall('a', 'oops {')).not.toBe(digestToolCall('b', 'oops {'));

    const guard = createLoopGuard();
    expect(guard.markAttempted('t', 'oops {')).toBe(true);
    expect(guard.hasAttempted('t', 'oops {')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// enableRepeatDetection 开关语义
// ---------------------------------------------------------------------------

describe('enableRepeatDetection = false', () => {
  it('markAttempted 恒为 true（no-op）、hasAttempted 恒为 false', () => {
    const guard = createLoopGuard({ enableRepeatDetection: false });
    expect(guard.markAttempted('tool_a', '{}')).toBe(true);
    expect(guard.markAttempted('tool_a', '{}')).toBe(true);
    expect(guard.hasAttempted('tool_a', '{}')).toBe(false);
  });

  it('开关只影响重复检测，其余防护不受影响', () => {
    const guard = createLoopGuard({ enableRepeatDetection: false });
    expect(guard.check(makeInput({ iterations: 10 }))).toEqual({
      stop: true,
      reason: 'max_steps',
    });
  });
});

// ---------------------------------------------------------------------------
// Partial config 合并
// ---------------------------------------------------------------------------

describe('Partial 配置合并', () => {
  it('无配置时使用 DEFAULT_LOOP_GUARD_CONFIG 全量默认值', () => {
    const guard = createLoopGuard();
    expect(guard.config).toEqual({
      maxSteps: 10,
      maxConcurrentTools: 4,
      enableRepeatDetection: true,
      tokenBudgetThreshold: undefined,
    });
  });

  it('maxSteps: 3 覆盖生效：iterations=2 继续，iterations=3 停止', () => {
    const guard = createLoopGuard({ maxSteps: 3 });
    expect(guard.config.maxSteps).toBe(3);
    expect(guard.check(makeInput({ iterations: 2 }))).toEqual({ stop: false });
    expect(guard.check(makeInput({ iterations: 3 }))).toEqual({
      stop: true,
      reason: 'max_steps',
    });
  });

  it('单字段覆盖不扰动其余默认值', () => {
    const guard = createLoopGuard({ tokenBudgetThreshold: 500 });
    expect(guard.config.maxSteps).toBe(10);
    expect(guard.config.maxConcurrentTools).toBe(4);
    expect(guard.config.enableRepeatDetection).toBe(true);
    expect(guard.config.tokenBudgetThreshold).toBe(500);
  });
});
