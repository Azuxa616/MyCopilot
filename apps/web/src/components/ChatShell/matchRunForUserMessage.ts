// matchRunForUserMessage - 用户消息 → Run 的匹配推导（计划 todo 12 的 S1-2 匹配语义）。
// 独立模块（非组件文件导出函数）以便测试直接断言匹配语义，
// 同时满足 react-refresh 对组件文件仅导出组件的约束（先例：selectSessionMessages.ts）。

import type { RunTraceWithStepCount } from '../../api'

/**
 * 从 runs 列表（GET /api/sessions/:id/runs，started_at 倒序）中取触发自该用户消息
 * 的最新一条 Run。匹配键是真实用户消息 id；userMessageId 装有 assistant 占位 id 的
 * 存量数据不会被匹配。
 */
export function matchRunForUserMessage(
  runs: RunTraceWithStepCount[] | undefined,
  userMessageId: string,
): RunTraceWithStepCount | undefined {
  return runs?.find((run) => run.userMessageId === userMessageId)
}
