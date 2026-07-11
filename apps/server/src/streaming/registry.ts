import { HttpError } from '../middleware/error.js';

/**
 * In-memory registry of active user-facing SSE streams.
 *
 * SEMANTICS:
 * One user-facing SSE stream = one registry entry per session.
 *
 * Agent-loop internal LLM calls share the session's AbortController —
 * they do NOT call `registerStream`/`unregisterStream` (that would
 * conflict with the user-facing stream singleton). Instead, they read
 * the signal via `getStreamSignal()` to detect user abort.
 */
const activeStreams = new Map<string, AbortController>();

/**
 * Register a new active stream for a session.
 *
 * @throws HttpError(409) if a stream is already active for this session.
 * @returns The AbortController for the stream.
 */
export function registerStream(sessionId: string): AbortController {
  if (activeStreams.has(sessionId)) {
    throw new HttpError(409, 'Another stream is active for this session');
  }
  const ac = new AbortController();
  activeStreams.set(sessionId, ac);
  return ac;
}

/**
 * Remove a stream from the registry (cleanup after stream ends).
 */
export function unregisterStream(sessionId: string): void {
  activeStreams.delete(sessionId);
}

/**
 * Abort an active stream by session ID.
 *
 * @returns `true` if a stream was found and aborted, `false` otherwise.
 */
export function abortStream(sessionId: string): boolean {
  const ac = activeStreams.get(sessionId);
  if (!ac) return false;
  ac.abort();
  activeStreams.delete(sessionId);
  return true;
}

/**
 * Read the AbortSignal for an active stream without affecting registry state.
 *
 * Used by the agent loop to observe user-initiated aborts without owning the
 * stream lifecycle (the user-facing SSE handler remains the registry owner).
 *
 * @returns The signal for the active stream, or `null` if none is registered.
 */
export function getStreamSignal(sessionId: string): AbortSignal | null {
  const ac = activeStreams.get(sessionId);
  return ac ? ac.signal : null;
}

/**
 * Get the current number of active streams (for graceful shutdown).
 */
export function getActiveStreamCount(): number {
  return activeStreams.size;
}
