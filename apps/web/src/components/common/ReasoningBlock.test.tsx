// ReasoningBlock.test.tsx — Tests for ReasoningBlock (Extended Thinking 渲染).

import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import ReasoningBlock from './ReasoningBlock'
import type { MessageWithReasoning } from '../../store/sessionStore'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Minimal render helper — mounts a React element into jsdom and returns the container. */
function renderReasoningBlock(message: MessageWithReasoning) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<ReasoningBlock message={message} />)
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

/** 最小合法 assistant 消息工厂（reasoningText 由测试覆写）。 */
function makeMessage(reasoningText?: string): MessageWithReasoning {
  return {
    id: 'msg-1',
    sessionId: 'sess-1',
    role: 'assistant',
    content: '正文',
    attachments: [],
    status: 'sent',
    createdAt: Date.now(),
    ...(reasoningText !== undefined ? { reasoningText } : {}),
  }
}

describe('ReasoningBlock', () => {
  it('renders nothing when message has no reasoningText', () => {
    const { container, unmount } = renderReasoningBlock(makeMessage())
    expect(container.innerHTML).toBe('')
    unmount()
  })

  it('is collapsed by default and hides the reasoning body', () => {
    const { container, unmount } = renderReasoningBlock(makeMessage('第一步先分析问题…'))

    const header = screen.getByText('思考过程').closest('button') as HTMLButtonElement
    expect(header).not.toBeNull()
    expect(header.getAttribute('aria-expanded')).toBe('false')

    // 折叠时正文不出现在 DOM
    expect(container.textContent).not.toContain('第一步先分析问题')

    unmount()
  })

  it('expands to show reasoning text on click and collapses again', () => {
    const { container, unmount } = renderReasoningBlock(makeMessage('第一步先分析问题…'))

    const header = screen.getByText('思考过程').closest('button') as HTMLButtonElement
    act(() => {
      header.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('第一步先分析问题')

    act(() => {
      header.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('第一步先分析问题')

    unmount()
  })

  // 计划 todo 13：reasoning 随消息持久化后，历史消息只有 message.reasoning
  // （无 live 态 reasoningText）——ReasoningBlock 以后者为回退渲染。
  it('renders from the persisted message.reasoning when reasoningText is absent', () => {
    const { container, unmount } = renderReasoningBlock({
      ...makeMessage(),
      reasoning: '历史持久化的推理全文',
    })

    const header = screen.getByText('思考过程').closest('button') as HTMLButtonElement
    expect(header).not.toBeNull()

    act(() => {
      header.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('历史持久化的推理全文')

    unmount()
  })

  it('prefers live reasoningText over the persisted reasoning', () => {
    const { container, unmount } = renderReasoningBlock({
      ...makeMessage(),
      reasoningText: 'live 增量',
      reasoning: 'persisted 全文',
    })

    act(() => {
      ;(screen.getByText('思考过程').closest('button') as HTMLButtonElement)
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('live 增量')
    expect(container.textContent).not.toContain('persisted 全文')

    unmount()
  })

  it('renders nothing when both reasoningText and reasoning are absent or null (旧消息回归)', () => {
    expect(renderReasoningBlock(makeMessage()).container.innerHTML).toBe('')
    expect(
      renderReasoningBlock({ ...makeMessage(), reasoning: null }).container.innerHTML,
    ).toBe('')
    expect(
      renderReasoningBlock({ ...makeMessage(), reasoning: '' }).container.innerHTML,
    ).toBe('')
  })
})
