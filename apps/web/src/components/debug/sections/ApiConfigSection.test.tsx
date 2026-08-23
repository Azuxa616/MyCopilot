// ApiConfigSection.test.tsx — Tests for debug modal section 2.
// SECURITY: authToken must NEVER appear in plaintext anywhere in the DOM.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'

import ApiConfigSection from './ApiConfigSection'
import { useConfigStore } from '../../../store/configStore'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

describe('ApiConfigSection', () => {
  let original: ReturnType<typeof useConfigStore.getState>

  beforeEach(() => {
    original = useConfigStore.getState()
  })

  afterEach(() => {
    useConfigStore.setState(original, true)
    document.body.innerHTML = ''
  })

  it('renders the section heading', () => {
    const { container } = render(<ApiConfigSection />)

    const heading = container.querySelector('h4')
    expect(heading).not.toBeNull()
    expect(heading!.textContent).toContain('API Configuration')
  })

  it('shows "Set" when authToken is present', () => {
    useConfigStore.setState({ authToken: 'sk-test-123' })

    const { container } = render(<ApiConfigSection />)

    const section = container.querySelector('[data-testid="api-config-section"]')!
    expect(section.textContent).toContain('Set')
    // CRITICAL: the plaintext token must never leak into the DOM.
    expect(section.textContent).not.toContain('sk-test-123')
    expect(document.body.textContent).not.toContain('sk-test-123')
  })

  it('shows "Not set" when authToken is null', () => {
    useConfigStore.setState({ authToken: null })

    const { container } = render(<ApiConfigSection />)

    const section = container.querySelector('[data-testid="api-config-section"]')!
    expect(section.textContent).toContain('Not set')
  })

  it('shows the current model id when set', () => {
    useConfigStore.setState({ currentModelId: 'gpt-4o' })

    const { container } = render(<ApiConfigSection />)

    expect(container.textContent).toContain('gpt-4o')
  })

  it('shows "none" for current model when null', () => {
    useConfigStore.setState({ currentModelId: null })

    const { container } = render(<ApiConfigSection />)

    expect(container.textContent).toContain('none')
  })

  it('never renders the authToken plaintext even with a realistic secret', () => {
    const secret = 'sk-proj-abcdef1234567890XYZ'
    useConfigStore.setState({ authToken: secret })

    const { container } = render(<ApiConfigSection />)

    // Grep the entire document body for the secret — it must be absent.
    expect(document.body.textContent).not.toContain(secret)
    expect(container.innerHTML).not.toContain(secret)
  })
})
