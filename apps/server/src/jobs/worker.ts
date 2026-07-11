import type { Job, Message } from '@my-copilot/shared';
import {
  claimJob,
  completeJob,
  failJob,
  reclaimStaleJobs,
  renewJobLease,
} from '../repo/job.js';

/**
 * Shape of the payload written by `streamMessageHandler` when creating an
 * `agent-loop` job in async mode. Defined here (not in shared) because it
 * is an internal contract between the HTTP handler and the worker.
 */
interface AgentLoopJobPayload {
  sessionId: string;
  userMessageId: string;
  userContent: string;
  history: Message[];
  attachments?: Array<{ name: string; content: string }>;
  adapterType: 'openai' | 'ollama';
  adapterConfig: { baseUrl: string; apiKey?: string; model: string };
}

/**
 * Single-process job worker.
 *
 * Polls the `jobs` table for pending work, claims one job at a time,
 * dispatches to a registered handler, and writes the result back. A
 * lease heartbeat extends `leased_at` while a job is running so that a
 * long handler is not reclaimed as stale. On startup any orphaned
 * `running` jobs from a previous crash are reset to `pending`.
 *
 * Concurrency is intentionally capped at 1 — the worker processes a
 * single job at a time. Worker pool / parallelism is YAGNI for now.
 */

const POLL_INTERVAL_MS = 1_000;
const LEASE_HEARTBEAT_MS = 30_000;
const STALE_LEASE_MS = 2 * 60 * 1000; // 2 minutes
const DEFAULT_WORKER_ID = process.env.JOB_WORKER_ID?.trim() || 'worker-1';
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

export type JobHandler = (
  job: Job,
  signal: AbortSignal,
) => Promise<Record<string, unknown>>;

const jobHandlers = new Map<string, JobHandler>();

let running = false;
let currentJobAbort: AbortController | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Register a handler for a job `type`. Re-registering the same type
 * replaces the previous handler. Handlers must be idempotent — the
 * same job may be dispatched more than once across crashes/retries.
 */
export function registerJobHandler(type: string, handler: JobHandler): void {
  jobHandlers.set(type, handler);
}

/** Remove all registered handlers. Mainly useful for tests. */
export function clearJobHandlers(): void {
  jobHandlers.clear();
}

/**
 * Begin polling. Reclaims stale jobs from a prior crash before the
 * first poll. Idempotent: a second call while running is a no-op.
 */
export async function start(): Promise<void> {
  if (running) return;
  running = true;

  // Reclaim jobs whose lease expired before we crashed — push them
  // back to `pending` so the new worker can pick them up.
  try {
    const reclaimed = reclaimStaleJobs(STALE_LEASE_MS);
    if (reclaimed > 0) {
      console.log(`[jobs] Reclaimed ${reclaimed} stale job(s)`);
    }
  } catch (err) {
    // Reclaim failure must not block polling.
    console.error('[jobs] reclaimStaleJobs failed:', err);
  }

  poll();
}

/**
 * Internal poll loop. Claims at most one job per tick (single-worker),
 * dispatches it to `processJob`, and reschedules. All external errors
 * are caught so the loop never dies.
 */
function poll(): void {
  if (!running) return;

  // Single-worker: skip claiming while a job is already in flight.
  // The next poll will pick up new work once the current job finishes.
  if (currentJobAbort) {
    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    return;
  }

  let job: Job | undefined;
  try {
    job = claimJob(DEFAULT_WORKER_ID);
  } catch (err) {
    console.error('[jobs] claimJob failed:', err);
  }

  if (job) {
    // Fire and forget — processJob owns its own error handling.
    processJob(job).catch((err) => {
      // Should be unreachable: processJob catches everything. Log and
      // continue so the loop never breaks.
      console.error('[jobs] processJob unexpectedly rejected:', err);
    });
  }

  pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
}

/**
 * Claimed-job lifecycle: heartbeat lease, dispatch to handler, then
 * complete or fail. Exposed so handlers / tests can drive a single
 * job end-to-end without going through the polling loop.
 */
export async function processJob(job: Job): Promise<void> {
  const ac = new AbortController();
  currentJobAbort = ac;

  // Heartbeat: extend the lease periodically so a long handler is
  // not reclaimed as stale. Errors here are logged but non-fatal —
  // the worst case is the job gets re-queued, which is recoverable.
  heartbeatTimer = setInterval(() => {
    try {
      renewJobLease(job.id, DEFAULT_WORKER_ID);
    } catch (err) {
      console.error('[jobs] lease heartbeat failed:', err);
    }
  }, LEASE_HEARTBEAT_MS);

  try {
    const handler = jobHandlers.get(job.type);
    if (!handler) {
      // Unknown type is terminal-failure: do not retry an unhandleable
      // job forever. The repo's failJob honours maxAttempts, but with
      // no handler the attempts will burn through quickly anyway.
      failJob(job.id, `Unknown job type: ${job.type}`);
      return;
    }

    const result = await handler(job, ac.signal);
    completeJob(job.id, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      failJob(job.id, message);
    } catch (failErr) {
      // If failJob itself throws (e.g. DB gone), we still need to
      // release the slot — the finally block handles that.
      console.error('[jobs] failJob threw:', failErr);
    }
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    currentJobAbort = null;
  }
}

/**
 * Graceful shutdown: stop polling, abort the in-flight job, and wait
 * (up to `timeoutMs`) for it to release the slot before returning.
 * Safe to call when nothing is running — returns immediately.
 */
export async function stop(timeoutMs: number = DEFAULT_STOP_TIMEOUT_MS): Promise<void> {
  running = false;

  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  // Abort the in-flight job (if any) and wait for processJob's finally
  // block to clear the slot. The handler is responsible for honoring
  // the abort signal; if it ignores the signal we give up after the
  // timeout and let the process exit / lease expire on its own.
  const pending = currentJobAbort;
  if (pending) {
    pending.abort();
    const deadline = Date.now() + timeoutMs;
    while (currentJobAbort !== null && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

// ---------------------------------------------------------------------------
// Built-in handler registration
// ---------------------------------------------------------------------------

/**
 * Register the `agent-loop` job handler that resumes an agent loop inside
 * a background worker (Step B async mode).
 *
 * The handler reads the payload written by `streamMessageHandler`, rebuilds
 * the provider adapter, and delegates to {@link runAgentLoopAsJob} which
 * collects all events into the job result JSON.
 *
 * Uses dynamic imports so that `worker.ts` stays free of agent-loop / llm /
 * tool dependencies at module load time — keeping the worker unit tests
 * isolated and the import graph shallow for callers that only need the
 * polling machinery.
 *
 * Tools are re-resolved via `listEnabledTools()` at execution time (not
 * read from the payload) so that toggling a tool between enqueue and
 * execution affects the run, matching sync-mode semantics exactly.
 */
export function registerAgentLoopHandler(): void {
  registerJobHandler('agent-loop', async (job, signal) => {
    // Dynamic imports — see function docstring.
    const [{ runAgentLoopAsJob }, { getAdapter }, { listEnabledTools }] =
      await Promise.all([
        import('../agent-loop/runner.js'),
        import('../llm/index.js'),
        import('../repo/tool.js'),
      ]);

    const payload = job.payload as unknown as AgentLoopJobPayload;
    const adapter = getAdapter(payload.adapterType);
    const tools = listEnabledTools();

    return runAgentLoopAsJob(
      job,
      {
        sessionId: payload.sessionId,
        userMessageId: payload.userMessageId,
        history: payload.history,
        userContent: payload.userContent,
        attachments: payload.attachments,
        tools,
        adapter,
        adapterConfig: payload.adapterConfig,
      },
      signal,
    );
  });
}
