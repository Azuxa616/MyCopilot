/**
 * Agent Loop v2 —— stop_reason 路由表与 Extended Thinking 提取（纯函数模块）。
 *
 * 对应 RFC《Agent Loop v2》（docs/rfc/agent-loop-v2.md）：
 * - §6 stop_reason 路由表：每次循环迭代以一个 stop_reason 终止，runner 通过
 *   一张显式、穷尽的数据表解析下一步动作，而非分散的 if/else。
 * - §3 Extended Thinking：推理文本与 content delta 分开推送；本模块提供
 *   从 StreamEvent 中提取推理增量的纯函数。
 *
 * 与 RFC 的差异：RFC §3 原文以 delta 事件上的可选 kind 字段暴露推理，
 * runtime 侧（T3 已落地）采用独立的 `{ type: 'reasoning' }` StreamEvent
 * 变体——形态以 packages/shared/src/stream-event.ts 为准，语义等价。
 *
 * 本模块只做查表与事件判别：不依赖 SSE、DB 或 runner。
 * runner 集成（查询路由表驱动 Run 状态转移）由后续任务（T11/T14）完成。
 */

import type { StopReason, StreamEvent } from '@my-copilot/shared';

/**
 * stop_reason 解析出的下一步动作（RFC §6）。
 *
 * - continue：执行工具调用并进入下一步迭代
 * - terminate_completed：终止，Run 记为 completed
 * - terminate_incomplete：终止，Run 记为 incomplete
 * - compress_context：压缩上下文后重试一次，仍超预算则终止（incomplete）
 * - terminate_cancelled：终止，Run 记为 cancelled
 * - error：报错终止，Run 记为 failed
 */
export type NextAction =
  | 'continue'
  | 'terminate_completed'
  | 'terminate_incomplete'
  | 'compress_context'
  | 'terminate_cancelled'
  | 'error';

/**
 * stop_reason → 下一步动作 的显式路由表（RFC §6）。
 * 这张表是数据：合规的 runner 在每次 Run 状态转换前查询它。
 */
export const STOP_REASON_ROUTING: Readonly<Record<StopReason, NextAction>> = {
  end_turn: 'terminate_completed',
  tool_use: 'continue',
  max_steps: 'terminate_incomplete',
  max_tokens: 'compress_context',
  user_interrupt: 'terminate_cancelled',
  error: 'error',
};

/**
 * 查询 stop_reason 对应的下一步动作（RFC §6）。
 *
 * 未知值（类型系统外的运行时脏数据）抛 Error（中文消息），由调用方
 * 按 error 路径处理；不做静默兜底。
 */
export function routeStopReason(reason: StopReason): NextAction {
  const action = STOP_REASON_ROUTING[reason];
  if (action === undefined) {
    throw new Error(`未知的 stop_reason："${reason}"（RFC §6 路由表中不存在此项）`);
  }
  return action;
}

/**
 * 从 StreamEvent 中提取 Extended Thinking 推理文本增量（RFC §3）。
 *
 * event.type === 'reasoning' 时返回其 text，其余事件一律返回 null。
 * 向后兼容：adapter 不推送 reasoning 事件时恒为 null。
 */
export function extractReasoning(event: StreamEvent): string | null {
  return event.type === 'reasoning' ? event.text : null;
}
