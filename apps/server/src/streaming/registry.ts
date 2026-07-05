import { HttpError } from '../middleware/error.js';

/** In-memory registry of active streaming sessions. */
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
 * Get the current number of active streams (for graceful shutdown).
 */
export function getActiveStreamCount(): number {
  return activeStreams.size;
}
