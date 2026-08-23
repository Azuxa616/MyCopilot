// StoreSnapshotSection - Debug modal section 3.
// Serializes a curated slice of the Zustand stores into a JSON snapshot.
// SECURITY: the snapshot is run through redactSensitive() BEFORE JSON.stringify,
// so authToken (and any other sensitive key) becomes "***REDACTED***" in both
// the on-screen <pre> and the clipboard payload.

import { useState } from 'react'
import { useSessionStore } from '../../../store/sessionStore'
import { useConfigStore } from '../../../store/configStore'
import { redactSensitive } from '../../../utils/redactor'

const MAX_SUMMARIES = 5
const MAX_MESSAGES = 50

/** Keys redacted by redactSensitive in this snapshot — surfaced to the user. */
const REDACTED_FIELDS = ['authToken'] as const

export default function StoreSnapshotSection() {
  const [copied, setCopied] = useState(false)

  // Point-in-time read: getState() captures the store at render time, which is
  // the right semantics for a "snapshot" you can copy and share.
  const sessionState = useSessionStore.getState()
  const configState = useConfigStore.getState()

  const currentSessionId =
    sessionState.selectedSessionId || sessionState.currentSession?.id || null

  // Truncate messagesCache: keep ONLY the current session, cap at the last
  // MAX_MESSAGES entries to avoid dumping huge histories into the snapshot.
  const truncatedMessagesCache: Record<string, unknown> = {}
  if (currentSessionId) {
    const msgs = sessionState.messagesCache[currentSessionId]
    if (msgs) {
      truncatedMessagesCache[currentSessionId] = msgs.slice(-MAX_MESSAGES)
    }
  }

  const snapshot = {
    sessionStore: {
      currentSessionId,
      sessionSummaries: sessionState.sessionSummaries.slice(0, MAX_SUMMARIES),
      messagesCache: truncatedMessagesCache,
      isSending: sessionState.isSending,
      pendingModelId: sessionState.pendingModelId,
      activeJobId: sessionState.activeJobId,
    },
    configStore: {
      currentSessionId: configState.currentSessionId,
      currentModelId: configState.currentModelId,
      authToken: configState.authToken,
      isTokenModalOpen: configState.isTokenModalOpen,
      tokenError: configState.tokenError,
    },
    redactedFields: [...REDACTED_FIELDS],
  }

  // MANDATORY: redact before serializing. The redacted object is what is shown
  // AND what is written to the clipboard.
  const redacted = redactSensitive(snapshot)
  const serialized = JSON.stringify(redacted, null, 2)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(serialized)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard may be unavailable (permissions, non-secure context) — no-op.
    }
  }

  return (
    <section data-testid="store-snapshot-section">
      <h4 className="text-sm font-semibold text-text-primary mb-1.5">
        Store Snapshot
      </h4>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-text-tertiary font-mono">
          redactedFields: [&lsquo;authToken&rsquo;]
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="px-2.5 py-1 text-xs text-text-primary bg-bg-secondary border border-border-base rounded hover:bg-bg-hover transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-[300px] overflow-auto font-mono text-xs text-text-primary bg-bg-secondary border border-border-base rounded p-2 whitespace-pre-wrap break-all">
        {serialized}
      </pre>
    </section>
  )
}
