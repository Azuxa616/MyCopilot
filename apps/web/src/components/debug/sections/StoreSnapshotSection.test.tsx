// StoreSnapshotSection.test.tsx — Tests for debug modal section 3.
// SECURITY: the serialized snapshot must redact authToken via redactSensitive()
// before reaching the DOM or the clipboard.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'
import type { Message } from '@my-copilot/shared'

import StoreSnapshotSection from './StoreSnapshotSection'
import { useConfigStore } from '../../../store/configStore'
import { useSessionStore } from '../../../store/sessionStore'

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

describe('StoreSnapshotSection', () => {
  let originalConfig: ReturnType<typeof useConfigStore.getState>
  let originalSession: ReturnType<typeof useSessionStore.getState>

  beforeEach(() => {
    originalConfig = useConfigStore.getState()
    originalSession = useSessionStore.getState()

    // Default mock for clipboard (jsdom does not provide one).
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
  })

  afterEach(() => {
    useConfigStore.setState(originalConfig, true)
    useSessionStore.setState(originalSession, true)
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders the section heading', () => {
    const { container } = render(<StoreSnapshotSection />)

    const heading = container.querySelector('h4')
    expect(heading).not.toBeNull()
    expect(heading!.textContent).toContain('Store Snapshot')
  })

  it('redacts authToken — plaintext NEVER appears in the DOM', () => {
    const secret = 'sk-test-123'
    useConfigStore.setState({ authToken: secret })
    useSessionStore.setState({ selectedSessionId: 'sess-1', sessionSummaries: [] })

    render(<StoreSnapshotSection />)

    // The secret must be absent from the entire document.
    expect(document.body.textContent).not.toContain(secret)
  })

  it('shows the ***REDACTED*** marker for authToken in the snapshot', () => {
    useConfigStore.setState({ authToken: 'sk-leak-me' })

    const { container } = render(<StoreSnapshotSection />)

    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre!.textContent).toContain('***REDACTED***')
    // The plaintext must not appear anywhere.
    expect(pre!.textContent).not.toContain('sk-leak-me')
  })

  it('shows the redactedFields indicator', () => {
    const { container } = render(<StoreSnapshotSection />)

    expect(container.textContent).toContain('redactedFields')
    expect(container.textContent).toContain('authToken')
  })

  it('serializes currentSessionId from the session store', () => {
    useSessionStore.setState({ selectedSessionId: 'sess-abc' })

    const { container } = render(<StoreSnapshotSection />)

    const pre = container.querySelector('pre')!
    expect(pre.textContent).toContain('sess-abc')
  })

  it('truncates sessionSummaries to at most 5 entries', () => {
    const summaries = Array.from({ length: 8 }, (_, i) => ({
      id: `s-${i}`,
      title: `Session ${i}`,
      messageCount: i,
      updatedAt: Date.now(),
      createdAt: Date.now(),
      modelId: null,
    }))
    useSessionStore.setState({ sessionSummaries: summaries })

    const { container } = render(<StoreSnapshotSection />)

    const pre = container.querySelector('pre')!
    // First 5 kept, the 6th/7th indices dropped.
    expect(pre.textContent).toContain('s-0')
    expect(pre.textContent).toContain('s-4')
    expect(pre.textContent).not.toContain('s-5')
    expect(pre.textContent).not.toContain('s-7')
  })

  it('truncates messagesCache to only the current session, max 50 messages', () => {
    // 60 messages in the current session, 3 in another session.
    const currentMsgs: Message[] = Array.from({ length: 60 }, (_, i) => ({
      id: `cur-${i}`,
      sessionId: 'sess-1',
      role: 'user',
      content: `msg-${i}`,
      attachments: [],
      status: 'sent',
      createdAt: Date.now(),
    }))
    const otherMsgs: Message[] = Array.from({ length: 3 }, (_, i) => ({
      id: `other-${i}`,
      sessionId: 'sess-2',
      role: 'user',
      content: `other-${i}`,
      attachments: [],
      status: 'sent',
      createdAt: Date.now(),
    }))

    useSessionStore.setState({
      selectedSessionId: 'sess-1',
      messagesCache: { 'sess-1': currentMsgs, 'sess-2': otherMsgs },
    })

    const { container } = render(<StoreSnapshotSection />)

    const pre = container.querySelector('pre')!
    // Only current session messages — last 50 (indices 10..59).
    expect(pre.textContent).toContain('cur-59')
    expect(pre.textContent).toContain('cur-10')
    expect(pre.textContent).not.toContain('cur-9')
    // The other session must NOT be present at all.
    expect(pre.textContent).not.toContain('sess-2')
    expect(pre.textContent).not.toContain('other-0')
  })

  it('Copy button writes the redacted snapshot to the clipboard', async () => {
    useConfigStore.setState({ authToken: 'sk-copy-secret' })

    const { container } = render(<StoreSnapshotSection />)

    const copyBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Copy',
    )
    expect(copyBtn).toBeDefined()

    await act(async () => {
      copyBtn!.click()
    })

    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>
    expect(writeText).toHaveBeenCalledTimes(1)
    const payload = writeText.mock.calls[0][0] as string
    // The clipboard payload must be redacted.
    expect(payload).not.toContain('sk-copy-secret')
    expect(payload).toContain('***REDACTED***')
  })
})
