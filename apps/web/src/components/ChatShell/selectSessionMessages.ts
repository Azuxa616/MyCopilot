// selectSessionMessages - 当前会话的消息推导
// 历史 tool 消息与带 toolCalls 的 assistant 消息不过滤：MessageCard 以「工具响应」卡
// 与 ToolCallsBlock 折叠卡渲染它们，保证刷新后工具调用过程仍可见。
// 独立模块（非组件文件导出函数）以便测试直接断言该放行语义。

import type { Message } from '@my-copilot/shared'

export function selectSessionMessages(
  messagesCache: Record<string, Message[]>,
  selectedSessionId: string,
): Message[] {
  return selectedSessionId ? (messagesCache[selectedSessionId] || []) : []
}
