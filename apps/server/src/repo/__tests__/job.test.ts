import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import {
  createJob,
  getJob,
  listJobs,
  listPendingJobs,
  listJobsBySession,
  claimJob,
  completeJob,
  failJob,
  cancelJob,
  reclaimStaleJobs,
  renewJobLease,
  updateJobProgress,
} from '../job.js';

describe('JobRepo', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-test-'));
    initDatabase(testDir);
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch {
      // ignore
    }
    if (testDir) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('createJob -> getJob returns a job with correct fields', () => {
    const job = createJob({
      type: 'agent-loop',
      payload: { topic: 'summarize', sessionId: 's1' },
    });

    expect(job.id).toBeDefined();
    expect(job.type).toBe('agent-loop');
    expect(job.payload).toEqual({ topic: 'summarize', sessionId: 's1' });
    expect(job.status).toBe('pending');
    expect(job.priority).toBe(0);
    expect(job.attempts).toBe(0);
    expect(job.maxAttempts).toBe(3);
    expect(job.leasedAt).toBeNull();
    expect(job.leaseOwner).toBeNull();
    expect(job.error).toBeNull();
    expect(job.result).toBeNull();
    expect(job.sessionId).toBeNull();
    expect(job.createdAt).toBeDefined();
    expect(job.updatedAt).toBe(job.createdAt);

    const fetched = getJob(job.id);
    expect(fetched).toEqual(job);
  });

  it('createJob honours priority, maxAttempts and sessionId options', () => {
    const job = createJob({
      type: 'agent-loop',
      payload: {},
      priority: 5,
      maxAttempts: 1,
      sessionId: 'sess-42',
    });

    expect(job.priority).toBe(5);
    expect(job.maxAttempts).toBe(1);
    expect(job.sessionId).toBe('sess-42');

    const fetched = getJob(job.id);
    expect(fetched!.priority).toBe(5);
    expect(fetched!.maxAttempts).toBe(1);
    expect(fetched!.sessionId).toBe('sess-42');
  });

  it('getJob returns undefined for unknown id', () => {
    expect(getJob('does-not-exist')).toBeUndefined();
  });

  it('listJobs returns all jobs; filter narrows by status', () => {
    const j1 = createJob({ type: 'agent-loop', payload: {} });
    const j2 = createJob({ type: 'agent-loop', payload: {} });

    const all = listJobs();
    expect(all).toHaveLength(2);
    expect(all.map((j) => j.id)).toEqual(expect.arrayContaining([j1.id, j2.id]));

    // claim one -> it becomes running
    claimJob('worker-A');
    const pending = listJobs({ status: 'pending' });
    const running = listJobs({ status: 'running' });
    expect(pending).toHaveLength(1);
    expect(running).toHaveLength(1);
    expect(running[0].status).toBe('running');
  });

  it('listPendingJobs returns only pending jobs ordered by priority DESC then created ASC', () => {
    const low = createJob({ type: 'agent-loop', payload: {}, priority: 1 });
    const high = createJob({ type: 'agent-loop', payload: {}, priority: 10 });
    const mid = createJob({ type: 'agent-loop', payload: {}, priority: 5 });

    const pending = listPendingJobs();
    expect(pending.map((j) => j.id)).toEqual([high.id, mid.id, low.id]);

    // limit respected
    expect(listPendingJobs(2)).toHaveLength(2);
    expect(listPendingJobs(2)[0].id).toBe(high.id);
  });

  it('listJobsBySession returns only jobs for that session', () => {
    const a1 = createJob({ type: 'agent-loop', payload: {}, sessionId: 'sess-A' });
    const a2 = createJob({ type: 'agent-loop', payload: {}, sessionId: 'sess-A' });
    createJob({ type: 'agent-loop', payload: {}, sessionId: 'sess-B' });

    const jobs = listJobsBySession('sess-A');
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.id)).toEqual(expect.arrayContaining([a1.id, a2.id]));
    expect(jobs.every((j) => j.sessionId === 'sess-A')).toBe(true);
  });

  it('claimJob atomically moves a pending job to running and increments attempts', () => {
    const job = createJob({ type: 'agent-loop', payload: {}, priority: 1 });
    expect(job.attempts).toBe(0);

    const claimed = claimJob('worker-1');
    expect(claimed).toBeDefined();
    expect(claimed!.id).toBe(job.id);
    expect(claimed!.status).toBe('running');
    expect(claimed!.attempts).toBe(1);
    expect(claimed!.leasedAt).not.toBeNull();
    expect(claimed!.leaseOwner).toBe('worker-1');

    // persisted
    const fetched = getJob(job.id);
    expect(fetched!.status).toBe('running');
    expect(fetched!.attempts).toBe(1);
    expect(fetched!.leaseOwner).toBe('worker-1');
  });

  it('claimJob returns undefined when no pending jobs exist', () => {
    expect(claimJob('worker-x')).toBeUndefined();

    // a running job should not be claimed
    createJob({ type: 'agent-loop', payload: {} });
    claimJob('worker-1');
    expect(claimJob('worker-2')).toBeUndefined();
  });

  it('claimJob picks the highest priority pending job first', () => {
    createJob({ type: 'agent-loop', payload: {}, priority: 1 });
    const high = createJob({ type: 'agent-loop', payload: {}, priority: 9 });

    const claimed = claimJob('worker-1');
    expect(claimed!.id).toBe(high.id);
  });

  it('completeJob stores result and moves status to done, clearing the lease', () => {
    const job = createJob({ type: 'agent-loop', payload: {} });
    claimJob('worker-1');

    const done = completeJob(job.id, { summary: 'hello', tokens: 42 });
    expect(done).toBeDefined();
    expect(done!.status).toBe('done');
    expect(done!.result).toEqual({ summary: 'hello', tokens: 42 });
    expect(done!.leasedAt).toBeNull();
    expect(done!.leaseOwner).toBeNull();
    expect(done!.error).toBeNull();

    const fetched = getJob(job.id);
    expect(fetched!.status).toBe('done');
    expect(fetched!.result).toEqual({ summary: 'hello', tokens: 42 });
  });

  it('failJob resets to pending when attempts < maxAttempts and records error', () => {
    const job = createJob({ type: 'agent-loop', payload: {}, maxAttempts: 3 });
    claimJob('worker-1'); // attempts -> 1

    const failed = failJob(job.id, 'boom');
    expect(failed).toBeDefined();
    expect(failed!.status).toBe('pending');
    expect(failed!.error).toBe('boom');
    expect(failed!.leasedAt).toBeNull();
    expect(failed!.leaseOwner).toBeNull();

    // ready to be claimed again
    expect(getJob(job.id)!.status).toBe('pending');
  });

  it('failJob marks status failed once attempts reach maxAttempts', () => {
    const job = createJob({ type: 'agent-loop', payload: {}, maxAttempts: 1 });
    claimJob('worker-1'); // attempts -> 1, now at max

    const failed = failJob(job.id, 'fatal');
    expect(failed).toBeDefined();
    expect(failed!.status).toBe('failed');
    expect(failed!.error).toBe('fatal');
    expect(failed!.attempts).toBe(1);
  });

  it('failJob returns undefined for unknown id', () => {
    expect(failJob('nope', 'x')).toBeUndefined();
  });

  it('cancelJob moves a pending job to cancelled', () => {
    const job = createJob({ type: 'agent-loop', payload: {} });
    const cancelled = cancelJob(job.id);
    expect(cancelled).toBeDefined();
    expect(cancelled!.status).toBe('cancelled');
    expect(getJob(job.id)!.status).toBe('cancelled');
  });

  it('cancelJob is a no-op on terminal jobs (done/failed/cancelled)', () => {
    const job = createJob({ type: 'agent-loop', payload: {} });
    claimJob('w');
    completeJob(job.id, { ok: true });

    expect(cancelJob(job.id)).toBeUndefined();
    expect(getJob(job.id)!.status).toBe('done');
  });

  it('reclaimStaleJobs resets expired running leases back to pending', () => {
    const job = createJob({ type: 'agent-loop', payload: {} });
    claimJob('worker-1');
    expect(getJob(job.id)!.status).toBe('running');

    // Force the lease into the past so it is considered stale.
    const staleLeasedAt = Date.now() - 60_000;
    getDb().prepare('UPDATE jobs SET leased_at = ? WHERE id = ?').run(staleLeasedAt, job.id);

    const reclaimed = reclaimStaleJobs(10_000);
    expect(reclaimed).toBe(1);

    const fetched = getJob(job.id);
    expect(fetched!.status).toBe('pending');
    expect(fetched!.leasedAt).toBeNull();
    expect(fetched!.leaseOwner).toBeNull();
  });

  it('reclaimStaleJobs leaves fresh leases alone and returns 0 when nothing is stale', () => {
    const job = createJob({ type: 'agent-loop', payload: {} });
    claimJob('worker-1');

    // fresh lease -> not stale
    expect(reclaimStaleJobs(60_000)).toBe(0);
    expect(getJob(job.id)!.status).toBe('running');
  });

  it('renewJobLease extends leased_at for the owning worker and returns true', () => {
    const job = createJob({ type: 'agent-loop', payload: {} });
    const claimed = claimJob('worker-1')!;
    const originalLeasedAt = claimed.leasedAt!;

    // Force the lease into the past so we can observe the renewal.
    getDb()
      .prepare('UPDATE jobs SET leased_at = ? WHERE id = ?')
      .run(originalLeasedAt - 60_000, job.id);

    const ok = renewJobLease(job.id, 'worker-1');
    expect(ok).toBe(true);

    const refreshed = getJob(job.id);
    expect(refreshed!.leasedAt).toBeGreaterThanOrEqual(originalLeasedAt);
    expect(refreshed!.status).toBe('running');
    expect(refreshed!.leaseOwner).toBe('worker-1');
  });

  it('renewJobLease returns false when the worker no longer owns the job', () => {
    const job = createJob({ type: 'agent-loop', payload: {} });
    claimJob('worker-1');

    // Different worker -> no row touched.
    expect(renewJobLease(job.id, 'someone-else')).toBe(false);

    // Completed job -> also false.
    completeJob(job.id, { ok: true });
    expect(renewJobLease(job.id, 'worker-1')).toBe(false);
  });

  it('updateJobProgress writes progress into result and touches updatedAt', () => {
    const job = createJob({ type: 'agent-loop', payload: {} });
    expect(job.result).toBeNull();

    updateJobProgress(job.id, 50);
    const mid = getJob(job.id);
    expect(mid!.result).toEqual({ progress: 50 });
    expect(mid!.updatedAt).toBeGreaterThanOrEqual(job.updatedAt);

    // existing result fields are preserved when progress updates
    claimJob('w');
    completeJob(job.id, { steps: 3 });
    updateJobProgress(job.id, 100);
    const final = getJob(job.id);
    expect(final!.result).toEqual({ steps: 3, progress: 100 });
  });

  it('updateJobProgress is a no-op for unknown id', () => {
    expect(() => updateJobProgress('missing', 1)).not.toThrow();
  });

  it('end-to-end retry lifecycle: pending -> running -> pending -> running -> done', () => {
    const job = createJob({ type: 'agent-loop', payload: {}, maxAttempts: 3 });

    // attempt 1 fails, returns to pending
    let claimed = claimJob('w1');
    expect(claimed!.attempts).toBe(1);
    failJob(job.id, 'retry-1');
    expect(getJob(job.id)!.status).toBe('pending');

    // attempt 2 fails, returns to pending
    claimed = claimJob('w2');
    expect(claimed!.attempts).toBe(2);
    failJob(job.id, 'retry-2');
    expect(getJob(job.id)!.status).toBe('pending');

    // attempt 3 succeeds
    claimed = claimJob('w3');
    expect(claimed!.attempts).toBe(3);
    completeJob(job.id, { ok: true });
    expect(getJob(job.id)!.status).toBe('done');
  });
});
