// ThinkingIndicator.test.tsx — Tests for ThinkingIndicator component.

import { beforeEach, describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import ThinkingIndicator from './ThinkingIndicator'
import { useSessionStore } from '../../store/sessionStore'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Minimal render helper — mounts a React element into jsdom and returns the container. */
function renderThinkingIndicator(alignRight = false) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<ThinkingIndicator alignRight={alignRight} />)
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe('ThinkingIndicator', () => {
  beforeEach(() => {
    useSessionStore.setState({ agentState: 'idle' })
  })

  it('renders nothing when agentState is not thinking', () => {
    for (const agentState of ['idle', 'tool_running', 'responding', 'error', 'cancelled'] as const) {
      useSessionStore.setState({ agentState })
      const { container, unmount } = renderThinkingIndicator()
      expect(container.innerHTML).toBe('')
      unmount()
    }
  })

  it('shows the thinking label with a spinner when thinking', () => {
    useSessionStore.setState({ agentState: 'thinking' })
    const { container, unmount } = renderThinkingIndicator()

    expect(screen.getByText('思考中…')).not.toBeNull()
    expect(container.querySelector('.animate-spin')).not.toBeNull()

    unmount()
  })

  it('aligns right when mounted under a user message', () => {
    useSessionStore.setState({ agentState: 'thinking' })
    const { container, unmount } = renderThinkingIndicator(true)

    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('justify-end')
    expect(root.className).toContain('pr-14')

    unmount()
  })
})
