// ChatShell/index.test.tsx — 历史消息过滤器修补（计划 todo 11 a）。
// ChatShell 的消息推导必须放行历史 tool 消息与带 toolCalls 的 assistant 消息
// （stale_state 场景：模拟 fetch 历史返回含 tool 消息后，派生列表不得丢弃它们）。
// 注：完整 ChatShell jsdom 渲染被 TanStack Virtual 在 jsdom 0 布局下的空视口行为
// 阻断（直接探针 getVirtualItems()=0），故以导出的推导函数为断言面——它与组件
// 消费的是同一段代码；工具消息的卡片渲染由 MessageCard.test.tsx 覆盖。

import { describe, it, expect } from 'vitest'
import type { Message } from '@my-copilot/shared'
import { selectSessionMessages } from './selectSessionMessages'

/** 一段含工具调用过程的会话历史（服务端 GET messages 真实形状）。 */
function historyWithToolCalls(): Message[] {
  const base = { sessionId: 's1', attachments: [] }
  const now = Date.now()
  return [
    { ...base, id: 'msg-u1', role: 'user', content: '帮我算 2+3', status: 'sent', createdAt: now - 4000 },
    {
      ...base,
      id: 'msg-a1',
      role: 'assistant',
      content: '我来调用计算器',
      toolCalls: [{ id: 'call-abc123def456', name: 'calculator', arguments: '{"expr":"2+3"}' }],
      status: 'sent',
      createdAt: now - 3000,
    },
    {
      ...base,
      id: 'msg-t1',
      role: 'tool',
      content: JSON.stringify([{ type: 'text', text: '计算结果 5' }]),
      toolCallId: 'call-abc123def456',
      status: 'sent',
      createdAt: now - 2000,
    },
    { ...base, id: 'msg-a2', role: 'assistant', content: '结果是 5', status: 'sent', createdAt: now - 1000 },
  ]
}

describe('selectSessionMessages 历史工具消息放行（修补 a）', () => {
  it('keeps tool messages and tool-call assistant messages after history load', () => {
    const messages = selectSessionMessages({ s1: historyWithToolCalls() }, 's1')

    expect(messages.map(m => m.id)).toEqual(['msg-u1', 'msg-a1', 'msg-t1', 'msg-a2'])
    // 工具调用请求（带 toolCalls 的 assistant）与工具响应（role='tool'）都不再被过滤
    expect(messages.some(m => m.role === 'tool' && m.toolCallId === 'call-abc123def456')).toBe(true)
    expect(messages.some(m => m.role === 'assistant' && (m.toolCalls?.length ?? 0) > 0)).toBe(true)
  })

  it('returns an empty list when no session is selected', () => {
    expect(selectSessionMessages({ s1: historyWithToolCalls() }, '')).toEqual([])
  })

  it('returns an empty list for a session missing from the cache', () => {
    expect(selectSessionMessages({}, 's1')).toEqual([])
  })
})
