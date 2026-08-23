// DebugModal.test.tsx — Tests for the dev-only debug modal skeleton.
// Uses vitest + jsdom + react-dom/client (no extra deps).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'

import DebugModal from './DebugModal'
import { useDebugStore } from '../../store/debugStore'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SECTION_HEADINGS = [
  'Git & Environment',
  'API Configuration',
  'Store Snapshot',
  'Backend Runtime',
  'Tool Calls Info',
] as const

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

describe('DebugModal', () => {
  let originalDev: boolean

  beforeEach(() => {
    originalDev = import.meta.env.DEV
    useDebugStore.setState({ isModalOpen: false })
  })

  afterEach(() => {
    vi.stubEnv('DEV', originalDev)
    useDebugStore.setState({ isModalOpen: false })
    document.body.innerHTML = ''
  })

  it('returns null when DEV is false', () => {
    vi.stubEnv('DEV', false)

    const { container } = render(<DebugModal />)

    expect(container.innerHTML).toBe('')
    expect(document.querySelector('[data-testid="debug-modal"]')).toBeNull()
  })

  it('does not render the modal body when store is closed', () => {
    vi.stubEnv('DEV', true)
    useDebugStore.setState({ isModalOpen: false })

    const { container } = render(<DebugModal />)

    // Modal returns null when open=false, so no dialog should appear.
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector('[data-testid="debug-modal"]')).toBeNull()
  })

  it('renders the modal with 5 section headings when open', () => {
    vi.stubEnv('DEV', true)
    useDebugStore.setState({ isModalOpen: true })

    const { container } = render(<DebugModal />)

    // The modal container should exist.
    const modalBody = container.querySelector('[data-testid="debug-modal"]')
    expect(modalBody).not.toBeNull()

    // All 5 section headings must be present.
    const headings = Array.from(modalBody!.querySelectorAll('h4')).map((h) => h.textContent)
    for (const expected of SECTION_HEADINGS) {
      expect(headings).toContain(expected)
    }
    expect(headings).toHaveLength(SECTION_HEADINGS.length)

    // Exactly 5 <section> elements.
    const sections = modalBody!.querySelectorAll('section')
    expect(sections).toHaveLength(5)
  })

  it('shows the "Debug Information" title', () => {
    vi.stubEnv('DEV', true)
    useDebugStore.setState({ isModalOpen: true })

    render(<DebugModal />)

    const titleEl = document.querySelector('h3')
    expect(titleEl).not.toBeNull()
    expect(titleEl!.textContent).toContain('Debug Information')
  })

  it('Close button calls closeModal and closes the modal', () => {
    vi.stubEnv('DEV', true)
    useDebugStore.setState({ isModalOpen: true })

    const { container } = render(<DebugModal />)

    // Find the Close button in the footer.
    const buttons = Array.from(container.querySelectorAll('button'))
    const closeBtn = buttons.find((b) => b.textContent?.trim() === 'Close')
    expect(closeBtn).toBeDefined()

    act(() => {
      closeBtn!.click()
    })

    expect(useDebugStore.getState().isModalOpen).toBe(false)
  })

  it('closes via Escape key (Modal built-in behavior)', () => {
    vi.stubEnv('DEV', true)
    useDebugStore.setState({ isModalOpen: true })

    render(<DebugModal />)

    // Modal should be open.
    expect(document.querySelector('[data-testid="debug-modal"]')).not.toBeNull()

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    // After ESC, the store should reflect the close.
    expect(useDebugStore.getState().isModalOpen).toBe(false)
  })
})
