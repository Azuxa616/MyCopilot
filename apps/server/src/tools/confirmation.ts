import type { ToolCall } from '@my-copilot/shared';

/**
 * In-memory store of pending high-danger tool confirmations.
 *
 * Design (T10 Step A — synchronous block):
 * - When a high-danger tool is invoked, the executor awaits
 *   `waitForConfirmation(callId, toolCall, timeout)` which returns a Promise
 *   that only resolves once the user approves/rejects via the confirm
 *   endpoint, or auto-rejects on timeout.
 * - The confirm endpoint calls `resolveConfirmation(callId, approved)` to
 *   settle the promise.
 * - `callId` is namespaced by sessionId (`${sessionId}:${toolCall.id}`) so a
 *   confirmation from one session cannot resolve another session's pending
 *   call.
 *
 * This is intentionally in-memory only — confirmations are ephemeral and do
 * not survive a restart. A restart clears pending confirmations, which means
 * an in-flight high-danger call resolves to `false` (rejected) via the
 * timeout path the next time anyone touches it. That is the desired
 * fail-safe behavior.
 */
interface PendingConfirmation {
  resolve: (approved: boolean) => void;
  reject: (reason: string) => void;
  toolCall: ToolCall;
  expiresAt: number;
}

const pendingConfirmations = new Map<string, PendingConfirmation>();

/** Thrown when a confirmation is rejected with a reason (vs. user "deny"). */
export class ConfirmationRejectedError extends Error {
  constructor(public readonly callId: string) {
    super(`Confirmation rejected for call ${callId}`);
    this.name = 'ConfirmationRejectedError';
  }
}

/**
 * Wait for user confirmation of a high-danger tool call.
 *
 * Resolves to `true` if the user approves, `false` if they deny or the
 * timeout elapses. The promise never rejects from the timeout path — a
 * timeout is treated as an implicit deny so the executor can return a
 * friendly "rejected" result rather than surfacing an error.
 */
export function waitForConfirmation(
  callId: string,
  toolCall: ToolCall,
  timeoutMs: number = 300_000,
): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const expiresAt = Date.now() + timeoutMs;

    // Auto-reject (resolve to false) on timeout. Clearing the timer is the
    // resolver's job; the timer callback only fires if no one resolves first.
    const timer = setTimeout(() => {
      pendingConfirmations.delete(callId);
      resolve(false);
    }, timeoutMs);

    pendingConfirmations.set(callId, {
      resolve: (approved: boolean) => {
        clearTimeout(timer);
        pendingConfirmations.delete(callId);
        resolve(approved);
      },
      reject: () => {
        clearTimeout(timer);
        pendingConfirmations.delete(callId);
        reject(new ConfirmationRejectedError(callId));
      },
      toolCall,
      expiresAt,
    });
  });
}

/**
 * Settle a pending confirmation. Called by the confirm endpoint.
 *
 * @returns `true` if a pending confirmation existed and was settled,
 *   `false` if `callId` has no pending confirmation (already resolved,
 *   timed out, or never created).
 */
export function resolveConfirmation(callId: string, approved: boolean): boolean {
  const pending = pendingConfirmations.get(callId);
  if (!pending) return false;
  pending.resolve(approved);
  return true;
}

/**
 * Get info about a pending confirmation (for the polling endpoint).
 *
 * Returns `undefined` if `callId` has no pending confirmation.
 */
export function getPendingConfirmation(
  callId: string,
): { toolCall: ToolCall; expiresAt: number } | undefined {
  const pending = pendingConfirmations.get(callId);
  if (!pending) return undefined;
  return { toolCall: pending.toolCall, expiresAt: pending.expiresAt };
}

/**
 * Clear all pending confirmations (test-only).
 *
 * Pending promises are resolved to `false` so awaiters do not hang.
 */
export function clearPendingConfirmations(): void {
  for (const pending of pendingConfirmations.values()) {
    pending.resolve(false);
  }
  pendingConfirmations.clear();
}
