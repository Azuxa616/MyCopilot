// DebugBadge.test.tsx — Tests for the dev-only floating badge.
// Uses vitest + jsdom + react-dom/client (no extra deps).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { ReactElement } from 'react'

import DebugBadge from './DebugBadge'
import { useDebugStore } from '../../store/debugStore'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Minimal render helper — mounts a React element into jsdom and returns the container. */
function render(ui: ReactElement): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe('DebugBadge', () => {
  let originalDev: boolean

  beforeEach(() => {
    originalDev = import.meta.env.DEV
    // Reset store between tests
    useDebugStore.setState({ isModalOpen: false })
  })

  afterEach(() => {
    vi.stubEnv('DEV', originalDev)
    vi.restoreAllMocks()
  })

  it('renders the badge when DEV is true', () => {
    vi.stubEnv('DEV', true)

    const { container } = render(<DebugBadge />)

    const badge = container.querySelector('[data-testid="dev-badge"]')
    expect(badge).not.toBeNull()
    expect(badge!.textContent).toContain('Dev')
  })

  it('returns null when DEV is false', () => {
    vi.stubEnv('DEV', false)

    const { container } = render(<DebugBadge />)

    // No badge element should exist in the DOM.
    const badge = container.querySelector('[data-testid="dev-badge"]')
    expect(badge).toBeNull()
    // The container should be empty (component rendered null).
    expect(container.innerHTML).toBe('')
  })

  it('opens the debug modal (via store) when clicked', () => {
    vi.stubEnv('DEV', true)
    expect(useDebugStore.getState().isModalOpen).toBe(false)

    const { container } = render(<DebugBadge />)
    const badge = container.querySelector('[data-testid="dev-badge"]')
    expect(badge).not.toBeNull()

    act(() => {
      badge!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(useDebugStore.getState().isModalOpen).toBe(true)
  })

  it('has amber styling distinct from functional badges', () => {
    vi.stubEnv('DEV', true)

    const { container } = render(<DebugBadge />)
    const badge = container.querySelector('[data-testid="dev-badge"]') as HTMLElement

    // The amber color family must be present to visually distinguish the debug badge.
    expect(badge.className).toContain('amber')
  })

  it('is positioned fixed at bottom-right with high z-index', () => {
    vi.stubEnv('DEV', true)

    const { container } = render(<DebugBadge />)
    const badge = container.querySelector('[data-testid="dev-badge"]') as HTMLElement

    expect(badge.className).toContain('fixed')
    expect(badge.className).toContain('bottom-4')
    expect(badge.className).toContain('right-4')
    expect(badge.className).toContain('z-40')
  })

  // Silence flushSync unused warning in case of future refactor
  it('uses flushSync import without error', () => {
    expect(typeof flushSync).toBe('function')
  })
})
