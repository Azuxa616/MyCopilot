// BackendRuntimeSection - Section 4 of DebugModal.
// Fetches /api/debug on mount with a 3s AbortController timeout.
// Manual "Refresh" only — NO auto-refresh / polling.
// Errors never bubble: every failure path renders an inline message + Retry.

import { useEffect, useState } from 'react'
import type { DebugEnvInfo } from '@my-copilot/shared'
import { useConfigStore } from '../../../store/configStore'

type Status = 'loading' | 'success' | 'error'

/** Hard cap for the debug fetch — backend should respond in well under a second. */
const FETCH_TIMEOUT_MS = 3000

/** Format uptime (seconds) as "Xh Ym Zs". */
function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h}h ${m}m ${s}s`
}

export default function BackendRuntimeSection() {
  const [status, setStatus] = useState<Status>('loading')
  const [data, setData] = useState<DebugEnvInfo | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')

  const fetchDebug = async () => {
    setStatus('loading')
    setErrorMsg('')

    // AbortController enforces the 3s cap. We never pass an external signal,
    // so this controller is the sole abort source.
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      // Read token lazily via getState() so this component doesn't re-render
      // on every token change — refresh is user-driven.
      const token = useConfigStore.getState().authToken
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch('/api/debug', { headers, signal: controller.signal })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      const json = (await res.json()) as DebugEnvInfo
      setData(json)
      setStatus('success')
    } catch (err) {
      // Distinguish abort (timeout) from other failures — the message wording
      // is part of the task spec.
      if (err instanceof Error && err.name === 'AbortError') {
        setErrorMsg('timeout')
      } else {
        setErrorMsg(err instanceof Error ? err.message : String(err))
      }
      setStatus('error')
    } finally {
      clearTimeout(timeoutId)
    }
  }

  useEffect(() => {
    void fetchDebug()
    // One-shot on mount; refresh is triggered by button clicks.
  }, [])

  return (
    <section data-testid="backend-runtime-section">
      <h4 className="text-sm font-semibold text-text-primary mb-1.5">
        Backend Runtime
      </h4>
      <p className="text-xs text-text-tertiary mb-2">
        Server health, database, and job worker status.
      </p>

      {status === 'loading' && (
        <p
          className="text-xs text-text-tertiary"
          data-testid="backend-runtime-loading"
        >
          Loading...
        </p>
      )}

      {status === 'error' && (
        <div data-testid="backend-runtime-error">
          <p className="text-xs text-text-tertiary mb-2">
            Backend unavailable: {errorMsg}
          </p>
          <button
            type="button"
            onClick={() => void fetchDebug()}
            className="px-3 py-1 text-xs text-text-primary bg-bg-secondary border border-border-base rounded-md hover:bg-bg-hover transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {status === 'success' && data && (
        <div data-testid="backend-runtime-data">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-text-tertiary">Node Version</dt>
            <dd className="text-text-primary break-all">{data.nodeVersion}</dd>

            <dt className="text-text-tertiary">Platform</dt>
            <dd className="text-text-primary break-all">{data.platform}</dd>

            <dt className="text-text-tertiary">Arch</dt>
            <dd className="text-text-primary break-all">{data.arch}</dd>

            <dt className="text-text-tertiary">Uptime</dt>
            <dd className="text-text-primary break-all">
              {formatUptime(data.uptime)}
            </dd>

            <dt className="text-text-tertiary">DB Path</dt>
            <dd className="text-text-primary break-all">{data.dbPath}</dd>

            <dt className="text-text-tertiary">Node Env</dt>
            <dd className="text-text-primary break-all">{data.nodeEnv}</dd>
          </dl>
          <button
            type="button"
            onClick={() => void fetchDebug()}
            className="mt-3 px-3 py-1 text-xs text-text-primary bg-bg-secondary border border-border-base rounded-md hover:bg-bg-hover transition-colors"
            data-testid="backend-runtime-refresh"
          >
            Refresh
          </button>
        </div>
      )}
    </section>
  )
}
