// BackendRuntimeSection.test.tsx — Tests for the Backend Runtime debug section.
// Covers success, generic fetch failure, and AbortController timeout.
// Uses vitest + jsdom + react-dom/client (matches DebugModal.test.tsx style).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'

import BackendRuntimeSection from './BackendRuntimeSection'
import { useConfigStore } from '../../../store/configStore'
import type { DebugEnvInfo } from '@my-copilot/shared'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const VALID_PAYLOAD: DebugEnvInfo = {
  nodeVersion: 'v20.11.0',
  platform: 'linux',
  arch: 'x64',
  uptime: 3661, // 1h 1m 1s
  dbPath: 'data/mycopilot.db',
  nodeEnv: 'development',
}

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

/**
 * Build a fetch mock that resolves immediately with `payload`. Used for the
 * success path — the abort listener is wired but never fires because the
 * promise settles on the first microtask.
 */
function makeSuccessFetch(payload: DebugEnvInfo) {
  return vi.fn((_url: string, opts?: RequestInit) => {
    // Still honor a pre-aborted signal for correctness.
    if (opts?.signal?.aborted) {
      const err = new Error('Aborted')
      err.name = 'AbortError'
      throw err
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => payload,
    } as Response)
  })
}

/**
 * Build a fetch mock that NEVER resolves on its own — only an abort signal
 * can settle it. Used to exercise the 3s timeout path.
 */
function makeHangingFetch() {
  return vi.fn((_url: string, opts?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = opts?.signal
      if (signal?.aborted) {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        reject(err)
        return
      }
      signal?.addEventListener('abort', () => {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        reject(err)
      })
    })
  })
}

describe('BackendRuntimeSection', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    useConfigStore.setState({ authToken: 'test-token' })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('renders DebugEnvInfo fields on successful fetch', async () => {
    globalThis.fetch = makeSuccessFetch(VALID_PAYLOAD) as typeof globalThis.fetch

    const { container } = render(<BackendRuntimeSection />)

    // Wait for the fetch promise chain to settle.
    await act(async () => {
      // Allow queued microtasks (fetch resolution + setState) to flush.
      await Promise.resolve()
      await Promise.resolve()
    })

    const data = container.querySelector('[data-testid="backend-runtime-data"]')
    expect(data).not.toBeNull()
    const text = data!.textContent ?? ''
    expect(text).toContain('v20.11.0')
    expect(text).toContain('linux')
    expect(text).toContain('x64')
    // uptime 3661s → "1h 1m 1s"
    expect(text).toContain('1h 1m 1s')
    expect(text).toContain('data/mycopilot.db')
    expect(text).toContain('development')

    // Sends Authorization header from configStore.authToken.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const callOpts = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as RequestInit
    expect((callOpts.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-token',
    )
  })

  it('shows "unavailable" message on fetch failure', async () => {
    globalThis.fetch = vi.fn(() => {
      return Promise.reject(new Error('network down'))
    }) as typeof globalThis.fetch

    const { container } = render(<BackendRuntimeSection />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const err = container.querySelector('[data-testid="backend-runtime-error"]')
    expect(err).not.toBeNull()
    expect(err!.textContent).toContain('Backend unavailable: network down')

    // Retry button present.
    const retry = err!.querySelector('button')
    expect(retry).not.toBeNull()
    expect(retry!.textContent?.trim()).toBe('Retry')
  })

  it('shows "timeout" message when AbortController fires', async () => {
    vi.useFakeTimers()

    // fetch hangs until the abort signal fires; our component wires the signal
    // to a 3s setTimeout, so advancing timers past 3000ms triggers the abort.
    globalThis.fetch = makeHangingFetch() as typeof globalThis.fetch

    const { container } = render(<BackendRuntimeSection />)

    // Initial state: loading.
    expect(
      container.querySelector('[data-testid="backend-runtime-loading"]'),
    ).not.toBeNull()

    // Cross the 3s threshold — the component's setTimeout calls controller.abort().
    // Flush microtasks thoroughly: the abort → fetch reject → await unwrap →
    // setStatus chain spans several then-callbacks.
    await act(async () => {
      vi.advanceTimersByTime(3001)
      for (let i = 0; i < 10; i++) {
        await Promise.resolve()
      }
    })

    const err = container.querySelector('[data-testid="backend-runtime-error"]')
    expect(err).not.toBeNull()
    expect(err!.textContent).toContain('Backend unavailable: timeout')
  })
})
