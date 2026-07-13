// ToolCallsBlock.test.tsx — Tests for ToolCallsBlock component.

import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'
import type { ToolCall } from '@my-copilot/shared'

import ToolCallsBlock from './ToolCallsBlock'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Minimal render helper — mounts a React element into jsdom and returns the container. */
function renderToolCallsBlock(message: { toolCalls?: ToolCall[] }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<ToolCallsBlock message={message} />)
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe('ToolCallsBlock', () => {
  const mockToolCall: ToolCall = {
    id: 'call-123',
    name: 'test_tool',
    arguments: JSON.stringify({ param: 'value' }),
  }

  it('renders tool block for message with toolCalls', () => {
    const { container, unmount } = renderToolCallsBlock({ toolCalls: [mockToolCall] })

    // Tool name should be visible in the button
    const toolName = screen.getByText('test_tool')
    expect(toolName).not.toBeNull()

    // The emoji should be present
    expect(container.textContent).toContain('🔧')

    unmount()
  })

  it('does not render for message without toolCalls', () => {
    const { container, unmount } = renderToolCallsBlock({ toolCalls: undefined })

    // Component should return null
    expect(container.innerHTML).toBe('')

    unmount()
  })

  it('does not render for empty toolCalls array', () => {
    const { container, unmount } = renderToolCallsBlock({ toolCalls: [] })

    // Component should return null for empty array
    expect(container.innerHTML).toBe('')

    unmount()
  })

  it('expands to show arguments on click', () => {
    const { container, unmount } = renderToolCallsBlock({ toolCalls: [mockToolCall] })

    // Find the button and click it
    const toolNameElement = screen.getAllByText('test_tool')[0]
    const button = toolNameElement.closest('button') as HTMLButtonElement
    expect(button).not.toBeNull()
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-expanded')).toBe('false')

    // Click the button to expand
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // Verify aria-expanded changed
    expect(button.getAttribute('aria-expanded')).toBe('true')

    // After clicking, the pre element with arguments should be visible
    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.textContent).toContain('"param"')
    expect(pre?.textContent).toContain('"value"')

    unmount()
  })

  it('renders multiple toolCalls', () => {
    const mockToolCalls: ToolCall[] = [
      {
        id: 'call-1',
        name: 'first_tool',
        arguments: JSON.stringify({ foo: 'bar' }),
      },
      {
        id: 'call-2',
        name: 'second_tool',
        arguments: JSON.stringify({ baz: 'qux' }),
      },
    ]

    const { container, unmount } = renderToolCallsBlock({ toolCalls: mockToolCalls })

    // Both tool names should be visible
    expect(screen.getByText('first_tool')).not.toBeNull()
    expect(screen.getByText('second_tool')).not.toBeNull()

    // Two emoji icons should be present
    const emojis = container.textContent?.match(/🔧/g)
    expect(emojis?.length).toBe(2)

    unmount()
  })
})