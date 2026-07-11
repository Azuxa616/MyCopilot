import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorMiddleware } from '../../middleware/error.js';
import { jobsApp } from '../jobs.js';

vi.mock('../../repo/job.js', () => ({
  listJobs: vi.fn(),
  listJobsBySession: vi.fn(),
  getJob: vi.fn(),
  cancelJob: vi.fn(),
}));

import {
  listJobs,
  listJobsBySession,
  getJob,
  cancelJob,
} from '../../repo/job.js';

function createTestApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/', jobsApp);
  return app;
}

const sampleJob = {
  id: 'j1',
  type: 'agent-loop' as const,
  payload: {},
  status: 'pending' as const,
  priority: 0,
  attempts: 0,
  maxAttempts: 3,
  leasedAt: null,
  leaseOwner: null,
  error: null,
  result: null,
  sessionId: 's1',
  createdAt: 1000,
  updatedAt: 1000,
};

/**
 * Read up to `maxBytes` from an SSE response body, returning the decoded text.
 * Used to assert on the initial flush of `/stream` without blocking forever
 * on the never-resolving keep-alive promise.
 */
async function readStreamChunk(
  body: ReadableStream<Uint8Array>,
  maxBytes = 4096,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      // SSE events are separated by blank lines; once we have at least one
      // complete event we have what we need.
      if (text.includes('\n\n')) break;
    }
  } finally {
    reader.releaseLock();
  }
  return text;
}

describe('jobs route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET / (list) ────────────────────────────────────────────────────────

  it('GET / lists all jobs when no filters', async () => {
    vi.mocked(listJobs).mockReturnValue([sampleJob]);

    const app = createTestApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({ code: 0, msg: 'ok', data: [sampleJob] });
    expect(listJobs).toHaveBeenCalledWith();
    expect(listJobsBySession).not.toHaveBeenCalled();
  });

  it('GET /?session_id= filters by session via listJobsBySession', async () => {
    vi.mocked(listJobsBySession).mockReturnValue([sampleJob]);

    const app = createTestApp();
    const res = await app.request('/?session_id=s1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([sampleJob]);
    expect(listJobsBySession).toHaveBeenCalledWith('s1');
    expect(listJobs).not.toHaveBeenCalled();
  });

  it('GET /?status= filters by status via listJobs', async () => {
    const running = { ...sampleJob, status: 'running' as const };
    vi.mocked(listJobs).mockReturnValue([running]);

    const app = createTestApp();
    const res = await app.request('/?status=running');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([running]);
    expect(listJobs).toHaveBeenCalledWith({ status: 'running' });
  });

  it('GET /?session_id=&status= combines both filters in-memory', async () => {
    const pending = { ...sampleJob, status: 'pending' as const };
    const running = { ...sampleJob, id: 'j2', status: 'running' as const };
    vi.mocked(listJobsBySession).mockReturnValue([pending, running]);

    const app = createTestApp();
    const res = await app.request('/?session_id=s1&status=running');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([running]);
  });

  // ─── GET /:id ────────────────────────────────────────────────────────────

  it('GET /:id returns job when found', async () => {
    vi.mocked(getJob).mockReturnValue(sampleJob);

    const app = createTestApp();
    const res = await app.request('/j1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual(sampleJob);
    expect(getJob).toHaveBeenCalledWith('j1');
  });

  it('GET /:id returns 404 when not found', async () => {
    vi.mocked(getJob).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/missing');
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe(404);
    expect(body.msg).toContain('Job not found');
  });

  // ─── POST /:id/cancel ────────────────────────────────────────────────────

  it('POST /:id/cancel cancels a live job and returns it', async () => {
    const cancelled = { ...sampleJob, status: 'cancelled' as const, updatedAt: 2000 };
    vi.mocked(cancelJob).mockReturnValue(cancelled);

    const app = createTestApp();
    const res = await app.request('/j1/cancel', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual(cancelled);
    expect(body.data.status).toBe('cancelled');
    expect(cancelJob).toHaveBeenCalledWith('j1');
  });

  it('POST /:id/cancel returns 404 when job is absent or terminal', async () => {
    vi.mocked(cancelJob).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/j1/cancel', { method: 'POST' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe(404);
    expect(body.msg).toContain('not found');
  });

  // ─── GET /stream (SSE) ───────────────────────────────────────────────────
  //
  // The stream handler holds itself open with a never-resolving promise that
  // only resolves on client abort. Each test reads the initial flush then
  // cancels the body reader so the underlying stream tears down cleanly.

  it('GET /stream emits every job as an initial job_update event', async () => {
    vi.mocked(listJobs).mockReturnValue([sampleJob]);

    const app = createTestApp();
    const res = await app.request('/stream');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/event-stream');

    const text = await readStreamChunk(res.body!);
    expect(text).toContain('event: job_update');
    expect(text).toContain(sampleJob.id);

    await res.body!.cancel();
  });

  it('GET /stream?since=<ts> only emits jobs updated after the watermark', async () => {
    const stale = { ...sampleJob, id: 'stale', updatedAt: 500 };
    const fresh = { ...sampleJob, id: 'fresh', updatedAt: 1500 };
    vi.mocked(listJobs).mockReturnValue([stale, fresh]);

    const app = createTestApp();
    const res = await app.request('/stream?since=1000');

    const text = await readStreamChunk(res.body!);
    expect(text).toContain('fresh');
    expect(text).not.toContain('stale');

    await res.body!.cancel();
  });

  it('GET /stream?session_id= scopes the stream via listJobsBySession', async () => {
    vi.mocked(listJobsBySession).mockReturnValue([sampleJob]);

    const app = createTestApp();
    const res = await app.request('/stream?session_id=s1');

    const text = await readStreamChunk(res.body!);
    expect(text).toContain(sampleJob.id);
    expect(listJobsBySession).toHaveBeenCalledWith('s1');
    expect(listJobs).not.toHaveBeenCalled();

    await res.body!.cancel();
  });

  it('GET /stream polls listJobs again after the poll interval elapses', async () => {
    vi.useFakeTimers();

    const job1 = { ...sampleJob, id: 'j1', updatedAt: 1000 };
    const job2 = { ...sampleJob, id: 'j2', updatedAt: 2000 };
    // Initial flush returns one job; the second call (post-poll) returns two,
    // so only job2 (updatedAt > lastSeen=1000) is pushed on the next tick.
    vi.mocked(listJobs).mockReturnValueOnce([job1]).mockReturnValueOnce([job1, job2]);

    const app = createTestApp();
    const res = await app.request('/stream');

    // Consume the initial event so the initial flush has flushed.
    await readStreamChunk(res.body!);
    expect(listJobs).toHaveBeenCalledTimes(1);

    // Advance past the poll interval — the setInterval callback fires and
    // re-queries listJobs, proving the polling loop is live.
    await vi.advanceTimersByTimeAsync(2000);
    expect(listJobs).toHaveBeenCalledTimes(2);

    await res.body!.cancel();
    vi.useRealTimers();
  });
});
