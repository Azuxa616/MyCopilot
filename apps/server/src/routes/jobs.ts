import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { JobStatus } from '@my-copilot/shared';
import {
  listJobs,
  listJobsBySession,
  getJob,
  cancelJob,
} from '../repo/job.js';
import { successResponse } from '../utils/response.js';
import { HttpError } from '../middleware/error.js';

export const jobsApp = new Hono();

/**
 * Polling interval (ms) for the SSE status stream. The server re-queries the
 * job table on this cadence and pushes any rows whose `updatedAt` advanced
 * past the last-seen watermark. Long enough to be cheap, short enough that a
 * UI feels live.
 */
export const JOB_STREAM_POLL_MS = 2000;

// GET / — list jobs with optional ?session_id= and ?status= filters.
//
// `session_id` delegates to `listJobsBySession` (a dedicated indexed query),
// while `status` feeds `listJobs`'s own filter. The two are orthogonal and
// may be combined.
jobsApp.get('/', (c) => {
  const sessionId = c.req.query('session_id');
  const status = c.req.query('status') as JobStatus | undefined;

  if (sessionId) {
    // Session filter is the common case (per-conversation job panel), so it
    // gets its own repo path. Status filtering is applied in-memory on top.
    const jobs = listJobsBySession(sessionId);
    const data = status ? jobs.filter((j) => j.status === status) : jobs;
    return successResponse(c, data);
  }

  const data = status ? listJobs({ status }) : listJobs();
  return successResponse(c, data);
});

// GET /stream — SSE stream of job status updates.
//
// MUST be registered before `/:id` so the static path wins. Clients pass a
// `since=<ms>` watermark for reconnect (only jobs updated after it are sent)
// and optionally `session_id=<id>` to scope the stream to one conversation.
//
// Without `since`, every job is emitted once up-front (the "initial state").
// The stream then stays open — polling on JOB_STREAM_POLL_MS — and pushes a
// `job_update` event for any row whose `updatedAt` moves past the watermark.
jobsApp.get('/stream', (c) => {
  const sinceStr = c.req.query('since');
  const since = sinceStr ? Number.parseInt(sinceStr, 10) : 0;
  const sessionId = c.req.query('session_id');

  return streamSSE(c, async (stream) => {
    // Watermark: only emit jobs with updatedAt strictly greater than this.
    // Starts at `since` (0 ⇒ emit everything on the first pass), advances as
    // events are pushed so each job is sent at most once per stream lifetime.
    let lastSeen = since;

    const collectUpdates = (): ReturnType<typeof listJobs> => {
      return sessionId ? listJobsBySession(sessionId) : listJobs();
    };

    const sendUpdates = async (): Promise<void> => {
      const jobs = collectUpdates();
      const updated = jobs.filter((j) => j.updatedAt > lastSeen);
      for (const job of updated) {
        await stream.writeSSE({
          event: 'job_update',
          data: JSON.stringify(job),
        });
        if (job.updatedAt > lastSeen) lastSeen = job.updatedAt;
      }
    };

    // 1. Initial flush — emits every job newer than `since` (or all of them
    //    when `since` is 0/omitted).
    await sendUpdates();

    // 2. Poll for subsequent changes. The interval is cleared both on abort
    //    and if a write throws (stream already torn down).
    const poll = setInterval(() => {
      void sendUpdates().catch(() => {
        clearInterval(poll);
      });
    }, JOB_STREAM_POLL_MS);

    // 3. Hold the stream open until the client disconnects. Hono fires
    //    `onAbort` when the connection drops; clearing the interval there
    //    prevents the leaked-timer footgun the task brief warned about.
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        clearInterval(poll);
        resolve();
      });
    });
  });
});

// GET /:id — fetch a single job. 404 when absent.
jobsApp.get('/:id', (c) => {
  const id = c.req.param('id');
  const data = getJob(id);
  if (!data) {
    throw new HttpError(404, 'Job not found');
  }
  return successResponse(c, data);
});

// POST /:id/cancel — mark a pending/running job as cancelled.
//
// `cancelJob` is a no-op on terminal jobs (done/failed/cancelled) and returns
// undefined, which we surface as 404 — there's no live job to cancel.
jobsApp.post('/:id/cancel', (c) => {
  const id = c.req.param('id');
  const data = cancelJob(id);
  if (!data) {
    throw new HttpError(404, 'Job not found or already terminal');
  }
  return successResponse(c, data);
});
