// AgentTimeline.test.tsx — Tests for AgentTimeline (过程时间线渲染).

import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import AgentTimeline from './AgentTimeline'
import type { TimelineEntry } from '../../types/timeline'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Minimal render helper — mounts a React element into jsdom and returns the container. */
function renderTimeline(entries: TimelineEntry[], live = false) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<AgentTimeline entries={entries} live={live} />)
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

const reasoning = (done: boolean): TimelineEntry => ({
  kind: 'reasoning', id: 'r-1', text: '先分析问题再调用工具', done,
})

const tool = (overrides: Partial<Extract<TimelineEntry, { kind: 'tool' }>> = {}): TimelineEntry => ({
  kind: 'tool', id: 'tc-1', name: 'resolve-library-id', status: 'done',
  startedAt: 1000, ...overrides,
})

describe('AgentTimeline', () => {
  it('renders nothing when entries is empty', () => {
    const { container, unmount } = renderTimeline([])
    expect(container.innerHTML).toBe('')
    unmount()
  })

  it('reasoning：live 且未完成时显示"思考中…"且默认展开', () => {
    const { container, unmount } = renderTimeline([reasoning(false)], true)
    const header = screen.getByText('思考中…').closest('button') as HTMLButtonElement
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('先分析问题再调用工具')
    unmount()
  })

  it('reasoning：历史回放显示"思考过程"且默认折叠', () => {
    const { container, unmount } = renderTimeline([reasoning(true)], false)
    const header = screen.getByText('思考过程').closest('button') as HTMLButtonElement
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('先分析问题再调用工具')
    unmount()
  })

  it('lead：弱化单行文本直接可见', () => {
    const { container, unmount } = renderTimeline([
      { kind: 'lead', id: 'l-1', text: '好的，我来调用…' },
    ])
    expect(container.textContent).toContain('好的，我来调用…')
    unmount()
  })

  it('tool done：摘要含工具名、✓ 与耗时；历史默认折叠，点击展开参数与结果', () => {
    const { container, unmount } = renderTimeline([
      tool({
        status: 'done',
        args: '{"libraryName":"React"}',
        result: '[{"type":"text","text":"libs"}]',
        endedAt: 3100,
      }),
    ])

    // 摘要：名称 + ✓ + 耗时 2.1s
    expect(container.textContent).toContain('resolve-library-id')
    expect(container.textContent).toContain('✓')
    expect(container.textContent).toContain('2.1s')

    // 折叠时详情不可见
    const header = screen.getByText('resolve-library-id').closest('button') as HTMLButtonElement
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('libraryName')

    // 展开后参数与结果可见
    act(() => {
      header.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('libraryName')
    expect(container.textContent).toContain('libs')
    unmount()
  })

  it('tool error：摘要显示 ✗；展开后结果区带错误标识', () => {
    const { container, unmount } = renderTimeline([
      tool({ status: 'error', result: 'boom', isError: true, endedAt: 1200 }),
    ])

    expect(container.textContent).toContain('✗')
    const header = screen.getByText('resolve-library-id').closest('button') as HTMLButtonElement
    act(() => {
      header.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('结果（错误）')
    expect(container.textContent).toContain('boom')
    unmount()
  })

  it('tool running：live 时默认展开且行带 role=status', () => {
    const { container, unmount } = renderTimeline([
      tool({ status: 'running', args: '{"q":1}' }),
    ], true)

    const row = container.querySelector('[role="status"]')
    expect(row).not.toBeNull()
    const header = screen.getByText('resolve-library-id').closest('button') as HTMLButtonElement
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('"q": 1')
    // running 且无 endedAt：不显示耗时
    expect(container.textContent).not.toMatch(/\d+\.\ds/)
    unmount()
  })

  it('结果超长截断：2000 字符后追加截断标记', () => {
    const long = 'x'.repeat(2500)
    const { container, unmount } = renderTimeline([
      tool({ result: long, endedAt: 1100 }),
    ])
    const header = screen.getByText('resolve-library-id').closest('button') as HTMLButtonElement
    act(() => {
      header.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('（结果已截断）')
    unmount()
  })

  it('无参数无结果的 running 条目：按钮禁用不可展开', () => {
    const { unmount } = renderTimeline([tool({ status: 'running' })], true)
    const header = screen.getByText('resolve-library-id').closest('button') as HTMLButtonElement
    expect(header.disabled).toBe(true)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    unmount()
  })
})
