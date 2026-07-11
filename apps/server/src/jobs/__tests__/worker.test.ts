import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Job } from '@my-copilot/shared';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test.
// ---------------------------------------------------------------------------

const mockClaimJob = vi.fn();
const mockCompleteJob = vi.fn();
const mockFailJob = vi.fn();
const mockReclaimStaleJobs = vi.fn();
const mockRenewJobLease = vi.fn();

vi.mock('../../repo/job.js', () => ({
  claimJob: (...args: unknown[]) => mockClaimJob(...args),
  completeJob: (...args: unknown[]) => mockCompleteJob(...args),
  failJob: (...args: unknown[]) => mockFailJob(...args),
  reclaimStaleJobs: (...args: unknown[]) => mockReclaimStaleJobs(...args),
  renewJobLease: (...args: unknown[]) => mockRenewJobLease(...args),
}));

import {
  start,
  stop,
  processJob,
  registerJobHandler,
  clearJobHandlers,
} from '../worker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    type: 'agent-loop',
    payload: {},
    status: 'running',
    priority: 0,
    attempts: 1,
    maxAttempts: 3,
    leasedAt: Date.now(),
    leaseOwner: 'worker-1',
    error: null,
    result: null,
    sessionId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('job worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClaimJob.mockReturnValue(undefined);
    mockCompleteJob.mockReturnValue(undefined);
    mockFailJob.mockReturnValue(undefined);
    mockReclaimStaleJobs.mockReturnValue(0);
    mockRenewJobLease.mockReturnValue(true);
    clearJobHandlers();
  });

  afterEach(async () => {
    // Make sure no timers / handlers leak between tests.
    await stop(200);
    clearJobHandlers();
  });

  // --- 1. start() reclaims stale jobs and begins polling ------------------
  it('start() reclaims stale jobs and calls claimJob on the first poll', async () => {
    await start();

    expect(mockReclaimStaleJobs).toHaveBeenCalledTimes(1);
    // Single-worker claims with a stable worker id.
    expect(mockClaimJob).toHaveBeenCalledWith('worker-1');
    // No job to process -> nothing dispatched.
    expect(mockCompleteJob).not.toHaveBeenCalled();
    expect(mockFailJob).not.toHaveBeenCalled();

    await stop();
  });

  // --- 2. processJob dispatches to the registered handler -----------------
  it('processJob dispatches to the registered handler with job + AbortSignal', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    registerJobHandler('test-type', handler);

    const job = makeJob({ type: 'test-type' });
    await processJob(job);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(job, expect.any(AbortSignal));
  });

  // --- 3. processJob completes on success ---------------------------------
  it('processJob completes the job with the handler result on success', async () => {
    const handler = vi.fn().mockResolvedValue({ summary: 'done', tokens: 7 });
    registerJobHandler('test-type', handler);

    const job = makeJob({ id: 'job-success', type: 'test-type' });
    await processJob(job);

    expect(mockCompleteJob).toHaveBeenCalledWith('job-success', {
      summary: 'done',
      tokens: 7,
    });
    expect(mockFailJob).not.toHaveBeenCalled();
  });

  // --- 4. processJob fails on handler error -------------------------------
  it('processJob calls failJob with the error message when the handler throws', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('handler boom'));
    registerJobHandler('test-type', handler);

    const job = makeJob({ id: 'job-fail', type: 'test-type' });
    await processJob(job);

    expect(mockFailJob).toHaveBeenCalledWith('job-fail', 'handler boom');
    expect(mockCompleteJob).not.toHaveBeenCalled();
  });

  // --- 5. stop() aborts the in-flight job ---------------------------------
  it('stop() aborts the currently running job signal', async () => {
    let capturedSignal: AbortSignal | undefined;
    const handler = vi.fn((_job, signal) => {
      capturedSignal = signal;
      // Never resolves on its own — only via abort. This mirrors a
      // long-running handler that respects the abort signal.
      return new Promise<Record<string, unknown>>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('aborted by stop'));
        });
      });
    });
    registerJobHandler('test-type', handler);

    mockClaimJob.mockReturnValueOnce(makeJob({ id: 'job-abort', type: 'test-type' }));

    await start();
    // Wait until the worker has dispatched the job.
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    await stop(500);

    expect(capturedSignal!.aborted).toBe(true);
    // The aborted handler rejects -> failJob is called by processJob.
    expect(mockFailJob).toHaveBeenCalledWith('job-abort', 'aborted by stop');
  });

  // --- 6. Unknown job type fails with descriptive message -----------------
  it('processJob fails an unknown job type with a descriptive message', async () => {
    // No handler registered for the default 'agent-loop' type.
    const job = makeJob({ id: 'job-unknown' });
    await processJob(job);

    expect(mockFailJob).toHaveBeenCalledTimes(1);
    expect(mockFailJob).toHaveBeenCalledWith(
      'job-unknown',
      expect.stringContaining('Unknown job type'),
    );
    expect(mockFailJob).toHaveBeenCalledWith(
      'job-unknown',
      expect.stringContaining('agent-loop'),
    );
    expect(mockCompleteJob).not.toHaveBeenCalled();
  });

  // --- 7. start() is idempotent ------------------------------------------
  it('start() is idempotent — repeated calls do not reclaim twice', async () => {
    await start();
    await start();

    expect(mockReclaimStaleJobs).toHaveBeenCalledTimes(1);

    await stop();
  });

  // --- 8. stop() is fast when nothing is running -------------------------
  it('stop() returns immediately when no job is in flight', async () => {
    await start();
    const begin = Date.now();
    await stop(1000);
    expect(Date.now() - begin).toBeLessThan(500);
  });

  // --- 9. Non-Error thrown values are stringified for failJob -------------
  it('processJob converts non-Error throw values to a string message', async () => {
    const handler = vi.fn().mockRejectedValue('string error'); // not an Error
    registerJobHandler('test-type', handler);

    const job = makeJob({ id: 'job-str', type: 'test-type' });
    await processJob(job);

    expect(mockFailJob).toHaveBeenCalledWith('job-str', 'string error');
  });

  // --- 10. Polling dispatches an end-to-end job via claimJob -------------
  it('a job returned by claimJob is dispatched and completed end-to-end', async () => {
    const handler = vi.fn().mockResolvedValue({ done: true });
    registerJobHandler('test-type', handler);

    const job = makeJob({ id: 'job-e2e', type: 'test-type' });
    mockClaimJob.mockReturnValueOnce(job);

    await start();
    await vi.waitFor(() => expect(mockCompleteJob).toHaveBeenCalled());

    expect(handler).toHaveBeenCalledWith(job, expect.any(AbortSignal));
    expect(mockCompleteJob).toHaveBeenCalledWith('job-e2e', { done: true });

    await stop();
  });
});
