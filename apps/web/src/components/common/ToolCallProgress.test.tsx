// ToolCallProgress.test.tsx — Tests for ToolCallProgress component.

import { beforeEach, describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import ToolCallProgress from './ToolCallProgress'
import { useSessionStore } from '../../store/sessionStore'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Minimal render helper — mounts a React element into jsdom and returns the container. */
function renderToolCallProgress() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<ToolCallProgress />)
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe('ToolCallProgress', () => {
  beforeEach(() => {
    useSessionStore.setState({ agentState: 'idle', activeToolCalls: [] })
  })

  it('renders nothing when agentState is idle', () => {
    const { container, unmount } = renderToolCallProgress()
    expect(container.innerHTML).toBe('')
    unmount()
  })

  it('renders nothing when activeToolCalls is empty', () => {
    useSessionStore.setState({ agentState: 'tool_running', activeToolCalls: [] })
    const { container, unmount } = renderToolCallProgress()
    expect(container.innerHTML).toBe('')
    unmount()
  })

  it('renders nothing outside tool_running state', () => {
    for (const agentState of ['thinking', 'responding', 'error', 'cancelled'] as const) {
      useSessionStore.setState({
        agentState,
        activeToolCalls: [{ id: 'tc-1', name: 'web_search', status: 'running' }],
      })
      const { container, unmount } = renderToolCallProgress()
      expect(container.innerHTML).toBe('')
      unmount()
    }
  })

  it('shows each tool call with the right status icon in tool_running state', () => {
    useSessionStore.setState({
      agentState: 'tool_running',
      activeToolCalls: [
        { id: 'tc-1', name: 'web_search', status: 'running' },
        { id: 'tc-2', name: 'http_get', status: 'done' },
      ],
    })
    const { container, unmount } = renderToolCallProgress()

    // Both tool names visible
    expect(screen.getByText('web_search')).not.toBeNull()
    expect(screen.getByText('http_get')).not.toBeNull()

    // running item shows a spinner, done item shows a check
    const spinners = container.querySelectorAll('.animate-spin')
    expect(spinners.length).toBe(1)
    expect(container.textContent).toContain('✓')

    unmount()
  })

  it('appears and disappears reactively with store state', () => {
    const { container, unmount } = renderToolCallProgress()
    expect(container.innerHTML).toBe('')

    // idle → tool_running: 进度列表出现
    act(() => {
      useSessionStore.setState({
        agentState: 'tool_running',
        activeToolCalls: [{ id: 'tc-1', name: 'calc', status: 'running' }],
      })
    })
    expect(screen.getByText('calc')).not.toBeNull()

    // tool_running → idle（终态清空 activeToolCalls）: 进度列表消失
    act(() => {
      useSessionStore.setState({ agentState: 'idle', activeToolCalls: [] })
    })
    expect(container.innerHTML).toBe('')

    unmount()
  })
})
