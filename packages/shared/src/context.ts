export type ContextStrategy = 'none' | 'truncate' | 'summarize';

export interface TokenEstimate {
  total: number;
  input: number;
  output: number;
}

// --- Context Management v2（RFC: docs/rfc/context-management-v2.md）---

/**
 * 预算桶名称：五个功能桶加预留 headroom。
 * 对应 RFC §1 五桶预算模型（Five-Bucket Budget Model）。
 */
export type BucketName = 'system' | 'tools' | 'history' | 'toolOutputs' | 'working' | 'headroom';

/**
 * 六桶预算配置：各桶占模型上下文窗口的比例（0..1），均为可选并带默认约定。
 * 对应 RFC §1 五桶预算模型。
 *
 * 硬约束：六个百分比之和必须恰好 = 1.0。
 * RFC §1 给出的区间：
 * - systemPct: 0.05-0.10
 * - toolsPct: 0.10-0.20
 * - historyPct: 0.30-0.40
 * - toolOutputsPct: 0.25-0.35
 * - workingPct: 0.10-0.15
 * - headroomPct: 0.05-0.10
 */
export interface BudgetConfig {
  /** system 桶占比（默认系统提示 + 注入的 skills + persona），RFC 区间 0.05-0.10 */
  systemPct?: number;
  /** tools 桶占比（LLM 调用的工具 schema），RFC 区间 0.10-0.20 */
  toolsPct?: number;
  /** history 桶占比（历史轮次 + summary 消息），RFC 区间 0.30-0.40 */
  historyPct?: number;
  /** toolOutputs 桶占比（本次运行中工具调用的结果），RFC 区间 0.25-0.35 */
  toolOutputsPct?: number;
  /** working 桶占比（当前用户轮次 + 解析后的附件），RFC 区间 0.10-0.15 */
  workingPct?: number;
  /** headroom 预留占比（框架 token、角色标签、回复空间），RFC 区间 0.05-0.10 */
  headroomPct?: number;
}

/**
 * 默认预算配置。对应 RFC §1。
 *
 * RFC §1 各桶区间的中值之和为 1.08（超过 1.0），因此在"总和必须恰好 = 1.0"
 * 的硬约束下于各桶区间内取值：
 * system 0.06（区间 0.05-0.10）、tools 0.14（0.10-0.20）、history 0.34（0.30-0.40）、
 * toolOutputs 0.28（0.25-0.35）、working 0.10（0.10-0.15）、headroom 0.08（0.05-0.10），
 * 总和 = 0.06+0.14+0.34+0.28+0.10+0.08 = 1.00。
 */
export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  systemPct: 0.06,
  toolsPct: 0.14,
  historyPct: 0.34,
  toolOutputsPct: 0.28,
  workingPct: 0.10,
  headroomPct: 0.08,
};

/**
 * 组装后每个桶实际分配的 token 数（含 total 汇总）。
 * 对应 RFC §1 五桶预算模型的预算分摊结果。
 */
export interface BudgetBreakdown {
  system: number;
  tools: number;
  history: number;
  toolOutputs: number;
  working: number;
  headroom: number;
  /** 六桶 token 数之和 */
  total: number;
}

/**
 * 当前上下文按桶的实际用量（headroom 为预留不计量，无 total 字段）。
 * 对应 RFC §1 五桶预算模型的用量跟踪。
 */
export interface TokenUsage {
  system: number;
  tools: number;
  history: number;
  toolOutputs: number;
  working: number;
}

/**
 * history 桶调度策略标识符。对应 RFC §2 多策略调度（Multi-Strategy Scheduling）。
 *
 * shared 侧使用下划线命名，与 RFC §2 表中的连字符名称一一对应：
 * - 'sliding_window' → RFC 'sliding-window'
 * - 'sliding_window_summary' → RFC 'sliding-window-summary'
 * - 'head_tail' → RFC 'head-tail-preserve'
 * - 'anchor' → RFC 'anchor-preserve'
 * - 'importance' → RFC 'importance-preserve'
 */
export type StrategyName =
  | 'sliding_window'
  | 'sliding_window_summary'
  | 'head_tail'
  | 'anchor'
  | 'importance';

/**
 * 跨会话记忆行（shared 侧简化形状）。对应 RFC §4 记忆持久化。
 * 时间字段为 ISO 8601 字符串。
 */
export interface MemoryRecord {
  id: string;
  sessionId: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}
