// MessageCard.test.tsx — 聊天流信息丢弃修补（计划 todo 11 b/d/f）的渲染断言。
// tool 消息「工具响应」卡（结果预览 + isError 红标）、aborted「已停止」标、多附件全量渲染。

import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

// svgr (?react) 是 vite-plugin-svgr 特性，vitest.config.ts 未启用 —— mock 图标模块。
vi.mock('../../assets/icon/retry.svg?react', () => ({ default: () => null }))
vi.mock('../../assets/icon/copy.svg?react', () => ({ default: () => null }))
vi.mock('../../assets/icon/delete.svg?react', () => ({ default: () => null }))

import MessageCard from './MessageCard'
import type { MessageWithToolError } from '../../store/sessionStore'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 最小合法消息工厂，测试按需覆写。 */
function makeMessage(overrides: Partial<MessageWithToolError> = {}): MessageWithToolError {
  return {
    id: 'm1',
    sessionId: 's1',
    role: 'assistant',
    content: '你好',
    attachments: [],
    status: 'sent',
    createdAt: Date.now() - 1000,
    ...overrides,
  }
}

/** 最小渲染 helper —— 挂载 MessageCard 并返回容器。 */
function renderMessageCard(message: MessageWithToolError) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<MessageCard message={message} />)
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe('MessageCard tool 消息渲染（修补 b）', () => {
  const toolMessage = (overrides: Partial<MessageWithToolError> = {}): MessageWithToolError =>
    makeMessage({
      id: 't1',
      role: 'tool',
      content: JSON.stringify([{ type: 'text', text: '计算结果 5' }]),
      toolCallId: 'call-abc123def456',
      ...overrides,
    })

  it('renders the tool response label and readable preview instead of raw JSON', () => {
    const { container, unmount } = renderMessageCard(toolMessage())

    expect(container.textContent).toContain('工具响应')
    expect(container.textContent).toContain('计算结果 5')
    // 结果预览必须提取 text 段，不能把原始 JSON 结构直接抛给用户
    expect(container.textContent).not.toContain('"type":"text"')

    unmount()
  })

  it('falls back to the raw content when it is not the JSON content-parts shape', () => {
    const { container, unmount } = renderMessageCard(toolMessage({ content: 'plain result' }))

    expect(container.textContent).toContain('plain result')

    unmount()
  })

  it('shows the error badge and error bubble styles when toolIsError is true', () => {
    const { container, unmount } = renderMessageCard(toolMessage({ toolIsError: true }))

    expect(container.textContent).toContain('执行出错')
    expect(container.querySelector('[class*="border-error/60"]')).not.toBeNull()

    unmount()
  })

  it('shows no error badge for a successful tool result', () => {
    const { container, unmount } = renderMessageCard(toolMessage({ toolIsError: false }))

    expect(container.textContent).not.toContain('执行出错')
    expect(container.querySelector('[class*="border-error/60"]')).toBeNull()

    unmount()
  })
})

describe('MessageCard 工具调用折叠卡与 aborted 标（修补 b/d）', () => {
  it('renders the ToolCallsBlock for an assistant message with toolCalls', () => {
    const { container, unmount } = renderMessageCard(
      makeMessage({
        content: '',
        toolCalls: [{ id: 'call-1', name: 'calculator', arguments: '{"expr":"2+3"}' }],
      }),
    )

    expect(container.textContent).toContain('calculator')

    unmount()
  })

  it('shows the partial content with an aborted mark on aborted assistant messages', () => {
    const { container, unmount } = renderMessageCard(
      makeMessage({ status: 'aborted', content: '部分回复内容' }),
    )

    expect(container.textContent).toContain('部分回复内容')
    expect(container.textContent).toContain('已停止')

    unmount()
  })
})

describe('MessageCard 多附件全量渲染（修补 f）', () => {
  it('renders every attachment instead of only the first', () => {
    const { container, unmount } = renderMessageCard(
      makeMessage({
        role: 'user',
        content: '帮我看这两个文件',
        attachments: [
          { id: 'att-1', name: 'notes.md', type: 'text/markdown', size: 1024 },
          { id: 'att-2', name: 'data.csv', type: 'text/csv', size: 2048 },
        ],
      }),
    )

    expect(screen.getAllByText('notes.md')).not.toBeNull()
    expect(screen.getAllByText('data.csv')).not.toBeNull()
    const titles = container.querySelectorAll('[title="notes.md"], [title="data.csv"]')
    expect(titles).toHaveLength(2)

    unmount()
  })
})

describe('MessageCard 历史消息思考过程回显（reasoning 持久化）', () => {
  it('renders the ReasoningBlock for a history assistant message with persisted reasoning', () => {
    const { unmount } = renderMessageCard(
      makeMessage({ reasoning: '服务端持久化的推理全文' }),
    )

    expect(screen.getByText('思考过程')).not.toBeNull()

    unmount()
  })

  it('renders no reasoning block for legacy messages with reasoning null/absent (回归保护)', () => {
    const withoutField = renderMessageCard(makeMessage())
    expect(screen.queryByText('思考过程')).toBeNull()
    withoutField.unmount()

    const nullReasoning = renderMessageCard(makeMessage({ reasoning: null }))
    expect(screen.queryByText('思考过程')).toBeNull()
    nullReasoning.unmount()
  })
})
