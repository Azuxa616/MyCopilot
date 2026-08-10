/**
 * Agent Loop v2 —— TypeScript 类型定义。
 *
 * 自包含模块：不从 @my-copilot/shared 或任何其他包导入。每个类型都内联声明，
 * 因此此文件可通过 `tsc --noEmit docs/rfc/types/agent-loop-v2.d.ts` 独立通过类型检查。
 *
 * 这些类型是被 docs/rfc/agent-loop-v2.md 和 docs/rfc/agent-loop-v2.schema.json
 * 引用的规范契约。
 */

// ---------------------------------------------------------------------------
// Run 生命周期
// ---------------------------------------------------------------------------

/**
 * Run 的生命周期状态，仿照 OpenAI Assistants 的 Run 生命周期建模。
 * Run 是一次 agent 调用的顶层执行单元。
 *
 * 状态机：
 *   queued -> in_progress -> requires_action -> in_progress (approved)
 *                                  |-> expired (confirmation timeout)
 *   in_progress -> completed | incomplete | cancelled | failed
 */
export type RunStatus =
  | 'queued'
  | 'in_progress'
  | 'requires_action'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'incomplete'
  | 'expired';

/**
 * Run（或单个循环迭代）停止的原因。驱动 RFC 规范章节中的显式路由表。
 */
export type StopReason =
  | 'end_turn' /** 模型发出完成信号。 */
  | 'tool_use' /** 模型请求工具调用；循环继续。 */
  | 'max_tokens' /** token 预算在生成过程中耗尽。 */
  | 'error' /** adapter、工具或 runner 抛出异常。 */
  | 'user_interrupt' /** 客户端触发 AbortSignal。 */
  | 'max_steps' /** 达到 LoopGuard 步数上限。 */;

// ---------------------------------------------------------------------------
// Run 步骤（每次循环迭代一个）
// ---------------------------------------------------------------------------

/** RunStep 所代表的工作类型。 */
export type RunStepType = 'llm_call' | 'tool_execution';

/** 单个 RunStep 的生命周期。 */
export type RunStepStatus = 'in_progress' | 'completed' | 'failed' | 'cancelled';

/** agent 循环的单次迭代。 */
export interface RunStep {
  id: string;
  runId: string;
  type: RunStepType;
  status: RunStepStatus;
  /** 在所属 Run 中从 1 开始的迭代索引。 */
  stepIndex: number;
  createdAt: number;
  completedAt?: number;
  /** 当 status === 'failed' 时填充。 */
  error?: string;
  /** 对此步骤产生的 ToolCallRecord id 的引用。 */
  toolCallIds?: string[];
}

// ---------------------------------------------------------------------------
// 工具调用
// ---------------------------------------------------------------------------

/** 由 LLM 发出的工具调用。 */
export interface ToolCallSpec {
  id: string;
  name: string;
  /** 原始 JSON 参数字符串（由模型发出）。 */
  arguments: string;
}

/** 执行一次工具调用的终态结果。 */
export type ToolCallOutcome =
  | { status: 'success'; result: string }
  | { status: 'error'; error: string }
  | { status: 'cancelled' }
  | { status: 'rejected' }; /** 用户拒绝了 confirmation_required 提示。 */

/** 一个工具调用加上其结果的完整记录。 */
export interface ToolCallRecord {
  id: string;
  runStepId: string;
  toolCall: ToolCallSpec;
  outcome: ToolCallOutcome;
  /** 稳定序列化参数的 SHA-256 十六进制摘要。 */
  argumentsDigest: string;
  startedAt: number;
  finishedAt?: number;
}

// ---------------------------------------------------------------------------
// 流式 delta（扩展思考）
// ---------------------------------------------------------------------------

/**
 * 一个 delta 数据块的判别符。默认为 'content'，这样忽略此可选字段的现有客户端
 * 仍可工作（对 SSE `delta` 事件的向后兼容扩展，而非新事件类型）。
 */
export type DeltaKind = 'content' | 'reasoning';

// ---------------------------------------------------------------------------
// LoopGuard v2 配置
// ---------------------------------------------------------------------------

/**
 * 完整 LoopGuard v2 防护层的配置。每个字段都有默认值；实现会在字段缺省时使用默认值。
 */
export interface LoopGuardConfig {
  /** 每个 Run 的最大 RunSteps。替代 v1 的 DEFAULT_MAX_ITERATIONS (10)。 */
  maxSteps: number;
  /** 每个 Run 中相同（name + argumentsDigest）工具调用的最大次数。 */
  maxRepeatCalls: number;
  /** 组装后 prompt 的软 token 预算。替代 v1 的 30000。 */
  tokenBudget: number;
  /** 运行上下文压缩前的最小未摘要消息数。 */
  minMessagesToCompress: number;
  /** 一个 RunStep 内并行工具调用的并发上限。 */
  maxConcurrentTools: number;
  /** 相似度阈值（0-1），超过则两次调用计为重复。 */
  repeatSimilarityThreshold: number;
}

/**
 * LoopGuardConfig 的解析默认值。值由 RFC（agent-loop-v2.md，规范 5）定义：
 * maxSteps = 10、maxRepeatCalls = 3、tokenBudget = 30000、
 * minMessagesToCompress = 5、maxConcurrentTools = 4、repeatSimilarityThreshold = 0.9。
 */
export declare const DEFAULT_LOOP_GUARD: LoopGuardConfig;

// ---------------------------------------------------------------------------
// Run 聚合
// ---------------------------------------------------------------------------

/** 顶层 Run 实体。 */
export interface Run {
  id: string;
  sessionId: string;
  agentId: string;
  status: RunStatus;
  /** 在终态时存在；解释 Run 为何结束。 */
  stopReason?: StopReason;
  steps: RunStep[];
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  /** 终止时累积的文本（对 cancelled/incomplete 可能是部分的）。 */
  partialContent: string;
  /** 当 status === 'failed' 时存在。 */
  error?: string;
}

// ---------------------------------------------------------------------------
// 前端 Run 进度状态机（B6：单循环，模式提示）
// ---------------------------------------------------------------------------

/**
 * Run 进度在前端可推导的视图。这**不是** chat/generate"模式"切换
 * （按决策 B6 的非目标）；它是 SSE 事件到小型 UI 状态词汇表的 1:1 投影。
 */
export type FrontendRunState =
  | 'idle'
  | 'thinking'
  | 'tool_running'
  | 'responding'
  | 'error'
  | 'cancelled';

// ---------------------------------------------------------------------------
// stop_reason 路由表
// ---------------------------------------------------------------------------

/** 显式 stop_reason 路由表的一行。 */
export interface StopReasonRouting {
  stopReason: StopReason;
  /** runner 接下来做什么。 */
  nextAction: 'continue' | 'terminate' | 'compress_context' | 'retry_once' | 'error';
  /** 如果没有进一步动作改变它，所产生的 RunStatus。 */
  resultingStatus: RunStatus;
}

/**
 * 完整的路由表。合规 runner 在转换 Run 之前通过此表解析每个 stop_reason。
 * 穷尽内容由 RFC（agent-loop-v2.md，规范 6）定义：
 *   end_turn -> terminate / completed
 *   tool_use -> continue / in_progress
 *   max_tokens -> compress_context / incomplete
 *   error -> error / failed
 *   user_interrupt -> terminate / cancelled
 *   max_steps -> terminate / incomplete
 */
export declare const STOP_REASON_ROUTING: StopReasonRouting[];
