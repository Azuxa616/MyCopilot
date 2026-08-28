/**
 * Agent 执行轨迹（Run Trace）共享类型。
 *
 * 描述一次 Run 的持久化记录（runs / run_steps 两张表对应的行形状）
 * 与采集接口（TraceCollector）。采集器由 server 侧实现并落库，
 * 本模块只声明类型，不含运行时逻辑。
 */

import type { BudgetBreakdown } from './context.js';
import type { RunStatus, StopReason } from './run.js';

/**
 * 一次 Run 的完整轨迹记录。对应 runs 表的行形状。
 */
export interface RunTraceRecord {
  /** Run 唯一 id（randomUUID 生成，不可枚举）。 */
  id: string;
  /** 所属会话 id。 */
  sessionId: string;
  /**
   * 触发本轮 Run 的真实用户消息 id。
   * ⚠️ 注意：不是 assistant 占位 id——`RunAgentLoopParams.userMessageId`
   * 的既有语义是占位 id（见 runner.ts 注释），采集时必须换用真实 id。
   */
  userMessageId: string;
  /** 本轮产出的 assistant 消息 id；尚未持久化时为 null。 */
  assistantMessageId: string | null;
  /** 执行本轮的 Agent id；未指定 Agent 时为 null。 */
  agentId: string | null;
  /** 异步链路对应的后台 job id；同步链路为 null。 */
  jobId: string | null;
  /** Run 生命周期状态，复用 run.ts 的 RunStatus。 */
  status: RunStatus;
  /** 终态停止原因，复用 run.ts 的 StopReason；非终态或未知时为 null。 */
  stopReason: StopReason | null;
  /** 实际执行的循环迭代次数。 */
  iterations: number;
  /** 最后一轮组装后的六桶预算快照（context.ts 的 BudgetBreakdown）；未采集时为 null。 */
  budgetSnapshot: BudgetBreakdown | null;
  /** 是否处于降级模式（预算压缩后仍超限等）。 */
  degraded: boolean;
  /** 本轮累计 token 估算值。 */
  totalTokens: number;
  /** 开始时间（ISO 8601 字符串，与 shared 既有时间字段约定一致）。 */
  startedAt: string;
  /** 结束时间（ISO 8601 字符串）；Run 未结束时为 null。 */
  endedAt: string | null;
  /** 终态为 failed 时的错误描述；其余为 null。 */
  error: string | null;
}

/**
 * 轨迹步骤类型：一次 LLM 调用或一批工具执行。
 * 与 run.ts 的 RunStepType（'message_creation' | 'tool_calls'）不同——
 * 本类型面向轨迹采集的观察视角。
 */
export type RunTraceStepType = 'llm_call' | 'tool_exec';

/**
 * Run 内单个步骤的轨迹记录。对应 run_steps 表的行形状。
 */
export interface RunStepRecord {
  /** 步骤唯一 id。 */
  id: string;
  /** 所属 Run 的 id。 */
  runId: string;
  /** 步骤在 Run 内的序号（run 内唯一，从 1 起）。 */
  seq: number;
  /** 步骤类型。 */
  type: RunTraceStepType;
  /** 工具名；type 为 'llm_call' 或工具名不可得时为 null。 */
  toolName: string | null;
  /** 工具参数预览（≤500 字符）；非工具步骤或不可得时为 null。 */
  argsPreview: string | null;
  /** 工具结果预览（≤500 字符）；非工具步骤或不可得时为 null。 */
  resultPreview: string | null;
  /** 该步骤是否以错误收场（含重复调用被跳过合成的 isError 结果）。 */
  isError: boolean;
  /** 步骤耗时（毫秒）。 */
  durationMs: number;
  /** 创建时间（ISO 8601 字符串）。 */
  createdAt: string;
}

/**
 * 轨迹采集器接口：runner 循环以旁路观察者身份调用，实现方自行落库。
 * 实现须保证采集异常不中断主流程（trace 失败绝不影响 loop）。
 */
export interface TraceCollector {
  /** Run 开始时调用；传入 RunTraceRecord 的部分字段（id、sessionId 等）。 */
  onRunStart(run: Partial<RunTraceRecord>): void;
  /** 每个步骤完成时调用；传入完整步骤记录。 */
  onStep(step: RunStepRecord): void;
  /** Run 终止时调用；传入终态相关字段（status、stopReason、iterations 等）。 */
  onRunEnd(run: Partial<RunTraceRecord>): void;
}
