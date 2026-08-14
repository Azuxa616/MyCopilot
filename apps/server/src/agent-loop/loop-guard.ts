/**
 * LoopGuard v2 —— Agent Loop v2 的统一循环防护层。
 *
 * 对应 RFC《Agent Loop v2》§5（LoopGuard v2：步数上限 + stop_reason 路由 +
 * 重复调用检测 + token 预算 + 用户中断）与 §6（stop_reason 路由表）。
 *
 * 本模块将 v1 分散在 runner.ts 中的三个防护常量（DEFAULT_MAX_ITERATIONS /
 * attemptedDigests 去重 / 摘要阈值）收敛为一个可配置的防护对象：
 * - {@link createLoopGuard} 工厂返回的 `check()` 在每个新步骤前评估，
 *   按固定优先级产出 StopReason（user_interrupt > max_steps > max_tokens），
 *   供 runner 查询 §6 路由表后转换 Run 状态；
 * - `markAttempted()` / `hasAttempted()` 承担 §5 重复调用检测的记名职责。
 *
 * ## digest bug 修复背景
 * 现有 `tools/executor.ts` 的 `digestToolCallArguments(rawArgs)` 只对参数做
 * sha256、不含工具名——不同工具携带相同参数（如两个工具都以 `{}` 调用）会被
 * 误判为重复。本模块的 {@link digestToolCall} 将工具名纳入 digest 输入
 * （`name + ':' + canonicalArgs`），修复该误判。executor.ts 本身的改造属于
 * T11 的集成范围，此处独立实现并导出修复后的算法。
 */
import { createHash } from 'node:crypto';
import type { LoopGuardConfig, StopReason } from '@my-copilot/shared';
import { DEFAULT_LOOP_GUARD_CONFIG } from '@my-copilot/shared';

// ---------------------------------------------------------------------------
// digest
// ---------------------------------------------------------------------------

/**
 * 计算一次工具调用的稳定 digest：sha256(`${toolName}:${canonical}`)。
 *
 * - 参数为合法 JSON 对象时，`canonical` 是键排序后的稳定序列化
 *   （对齐 executor.ts 的 parse → stableSerialize → sha256 管线，
 *   键顺序不同但语义相同的参数得到相同 digest）；
 * - 参数非 JSON（或非对象）时退化为对 `${toolName}:${rawArgs}` 原文的
 *   hash——对齐 runner.ts 现有 parse-fallback 行为，但始终不抛错。
 *
 * 相比 `digestToolCallArguments(rawArgs)`（不含工具名），本函数把工具名纳入
 * digest 输入，因此不同工具同参数不会被误判为重复调用。
 */
export function digestToolCall(toolName: string, rawArgs: string): string {
  const parsed = tryParseJsonObject(rawArgs);
  const canonical = parsed === null ? rawArgs : stableSerialize(parsed);
  return sha256(`${toolName}:${canonical}`);
}

/** JSON.parse 并校验为对象；任何失败返回 null（永不抛错）。 */
function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 键排序的稳定序列化（与 executor.ts 的 stableSerialize 同构）。 */
function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// ---------------------------------------------------------------------------
// check 输入 / 输出
// ---------------------------------------------------------------------------

/**
 * `check()` 的输入：进入新步骤前的循环状态快照。
 *
 * `attemptedDigests` 为本 Run 已尝试过的工具调用 digest 集合（通常来自
 * `markAttempted` 维护的内部 Set）。当前 runtime 侧 `LoopGuardConfig` 未含
 * `maxRepeatCalls`（RFC §5 的按次数重复路由），重复检测由 `markAttempted`
 * 的返回值承担，`check()` 暂不基于该集合触发停止。
 */
export interface LoopGuardCheckInput {
  /** 当前已完成的循环迭代数（RunStep 计数）。 */
  iterations: number;
  /** 组装后历史消息的 token 估算总量。 */
  historyTokens: number;
  /** 从前端 AbortController 一路传播下来的取消信号（RFC §4）。 */
  abortSignal: AbortSignal;
  /** 本 Run 已尝试的工具调用 digest 集合。 */
  attemptedDigests: ReadonlySet<string>;
}

/** `check()` 的输出：是否停止及对应的 stop_reason（RFC §6 路由表键）。 */
export interface LoopGuardCheckResult {
  stop: boolean;
  reason?: StopReason;
}

/** LoopGuard 防护对象：配置快照 + 步前检查 + 重复调用记名。 */
export interface LoopGuard {
  /** 合并默认值后的生效配置。 */
  config: LoopGuardConfig;
  /** 在每个新步骤前评估防护条件，按固定优先级产出 stop_reason。 */
  check(input: LoopGuardCheckInput): LoopGuardCheckResult;
  /**
   * 记录一次工具调用为已尝试。
   * @returns 是否首次调用（false = 与本 Run 内先前调用重复）。
   */
  markAttempted(toolName: string, rawArgs: string): boolean;
  /** 查询某次工具调用是否已在本 Run 内尝试过。 */
  hasAttempted(toolName: string, rawArgs: string): boolean;
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

/**
 * 创建一个 LoopGuard 防护实例。`config` 为 Partial，逐字段与
 * {@link DEFAULT_LOOP_GUARD_CONFIG} 合并（显式传入 `undefined` 视为未提供）。
 *
 * `check()` 的评估优先级（RFC §5 → §6）：
 * 1. `abortSignal.aborted` → `user_interrupt`（Run `cancelled`）
 * 2. `iterations >= maxSteps` → `max_steps`（Run `incomplete`）
 * 3. `tokenBudgetThreshold` 有值且 `historyTokens` 严格超过 → `max_tokens`
 *    （Run `incomplete`）
 * 4. 否则 `{ stop: false }`，循环继续。
 *
 * `enableRepeatDetection = false` 时 `markAttempted` 退化为 no-op（恒返回
 * true）、`hasAttempted` 恒为 false——即完全关闭重复检测，不影响其余防护。
 */
export function createLoopGuard(config?: Partial<LoopGuardConfig>): LoopGuard {
  const merged: LoopGuardConfig = {
    maxSteps: config?.maxSteps ?? DEFAULT_LOOP_GUARD_CONFIG.maxSteps,
    maxConcurrentTools:
      config?.maxConcurrentTools ?? DEFAULT_LOOP_GUARD_CONFIG.maxConcurrentTools,
    enableRepeatDetection:
      config?.enableRepeatDetection ?? DEFAULT_LOOP_GUARD_CONFIG.enableRepeatDetection,
    tokenBudgetThreshold:
      config?.tokenBudgetThreshold ?? DEFAULT_LOOP_GUARD_CONFIG.tokenBudgetThreshold,
  };

  const attempted = new Set<string>();

  return {
    config: merged,
    check(input) {
      if (input.abortSignal.aborted) {
        return { stop: true, reason: 'user_interrupt' };
      }
      if (input.iterations >= merged.maxSteps) {
        return { stop: true, reason: 'max_steps' };
      }
      if (
        merged.tokenBudgetThreshold !== undefined &&
        input.historyTokens > merged.tokenBudgetThreshold
      ) {
        return { stop: true, reason: 'max_tokens' };
      }
      return { stop: false };
    },
    markAttempted(toolName, rawArgs) {
      if (!merged.enableRepeatDetection) return true;
      const d = digestToolCall(toolName, rawArgs);
      if (attempted.has(d)) return false;
      attempted.add(d);
      return true;
    },
    hasAttempted(toolName, rawArgs) {
      if (!merged.enableRepeatDetection) return false;
      return attempted.has(digestToolCall(toolName, rawArgs));
    },
  };
}
