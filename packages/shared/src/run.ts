/**
 * Agent Loop v2 —— Run 生命周期与循环防护共享类型。
 *
 * 从 RFC 权威类型源 docs/rfc/types/agent-loop-v2.d.ts 提取并适配为 runtime 类型
 * （移除 RFC-only 的 declare 常量与规范内部字段）。字段形态以本文件为准，
 * 与 RFC 的差异在各类型 JSDoc 中注明。
 */

import type { BudgetBreakdown } from './context.js';
import type { ToolCall } from './session.js';

/**
 * Run 的生命周期状态，仿照 OpenAI Assistants 的 Run 生命周期建模。
 * Run 是一次 agent 调用的顶层执行单元。对应 RFC §1 Run 生命周期。
 *
 * 状态机：
 *   queued -> in_progress -> requires_action -> in_progress (approved)
 *                                   |-> expired (confirmation timeout)
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
 * Run（或单个循环迭代）停止的原因，驱动 runner 的显式路由表。
 * 对应 RFC §6 stop_reason 路由表。
 */
export type StopReason =
  /** 模型发出完成信号。 */
  | 'end_turn'
  /** 模型请求工具调用；循环继续。 */
  | 'tool_use'
  /** 达到 LoopGuard 步数上限。 */
  | 'max_steps'
  /** token 预算在生成过程中耗尽。 */
  | 'max_tokens'
  /** 客户端触发 AbortSignal。 */
  | 'user_interrupt'
  /** adapter、工具或 runner 抛出异常。 */
  | 'error';

/**
 * RunStep 所代表的工作类型：消息创建或工具调用批次。
 * 对应 RFC §2 Run 步骤（RFC 原名 llm_call / tool_execution，runtime 侧更名为
 * message_creation / tool_calls）。
 */
export type RunStepType = 'message_creation' | 'tool_calls';

/**
 * 单个 RunStep 的生命周期。对应 RFC §2 Run 步骤。
 */
export type RunStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * agent 循环的单次迭代。对应 RFC §2 Run 步骤。
 *
 * 与 RFC 的差异：省略 stepIndex/completedAt/error/toolCallIds 等 RFC-only 扩展字段；
 * createdAt 由 epoch 毫秒数改为 ISO 8601 字符串（与 shared 既有时间字段约定一致）。
 */
export interface RunStep {
  id: string;
  /** 所属 Run 的 id。 */
  runId: string;
  type: RunStepType;
  status: RunStepStatus;
  /** 创建时间（ISO 8601 字符串）。 */
  createdAt: string;
}

/**
 * Run 循环内消息的最小结构。字段兼容 server 侧的 ChatMessage
 * （apps/server/src/llm/base.ts）但独立声明——shared 不依赖 server；
 * toolCalls 复用 shared 的 ToolCall（session.ts）。
 */
export interface RunChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** null 表示仅含 toolCalls、无文本内容的 assistant 消息。 */
  content: string | null;
  /** assistant 消息请求的工具调用。 */
  toolCalls?: ToolCall[];
  /** tool 角色消息引用的父工具调用 id。 */
  toolCallId?: string;
}

/**
 * LoopGuard 循环防护配置。对应 RFC §5 LoopGuard v2 配置
 * （RFC 为 6 字段，runtime 侧收敛为 4 字段子集）。
 */
export interface LoopGuardConfig {
  /** 每个 Run 的最大 RunSteps（默认约定 10，替代 v1 的 DEFAULT_MAX_ITERATIONS）。 */
  maxSteps: number;
  /** 一个 RunStep 内并行工具调用的并发上限（默认约定 4）。 */
  maxConcurrentTools: number;
  /** 是否启用重复工具调用检测。 */
  enableRepeatDetection: boolean;
  /** token 预算告警阈值（可选，缺省不设阈值）。 */
  tokenBudgetThreshold?: number;
}

/**
 * LoopGuardConfig 的默认值（maxSteps = 10、maxConcurrentTools = 4、
 * enableRepeatDetection = true、tokenBudgetThreshold 不设置）。
 */
export const DEFAULT_LOOP_GUARD_CONFIG: LoopGuardConfig = {
  maxSteps: 10,
  maxConcurrentTools: 4,
  enableRepeatDetection: true,
};

/**
 * Run 的运行上下文：进入循环前的消息序列、组装后的预算分摊与降级标记。
 * budget 来自 context.ts 的六桶预算模型（对应 RFC《Context Management v2》§1）。
 */
export interface RunContext {
  messages: RunChatMessage[];
  /** 组装后各预算桶实际分配的 token 数（含 total 汇总）。 */
  budget: BudgetBreakdown;
  /** 是否处于降级模式（如预算压缩后仍超限、或重复调用检测被关闭）。 */
  degraded: boolean;
}
