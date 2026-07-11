import { describe, it, expect } from 'vitest';
import type { Job } from '@my-copilot/shared';
import {
    parseJobEvents,
    computeBackoff,
    TERMINAL_JOB_STATUSES,
    MAX_BACKOFF_MS,
    INITIAL_BACKOFF_MS,
} from './useJobStream';

/** Minimal valid job factory for tests. */
function makeJob(overrides: Partial<Job> = {}): Job {
    return {
        id: 'job-1',
        type: 'agent-loop',
        payload: {},
        status: 'running',
        priority: 0,
        attempts: 0,
        maxAttempts: 3,
        leasedAt: null,
        leaseOwner: null,
        error: null,
        result: null,
        sessionId: 'sess-1',
        createdAt: 1000,
        updatedAt: 1000,
        ...overrides,
    };
}

describe('parseJobEvents', () => {
    it('parses a well-formed data line into a job', () => {
        const job = makeJob({ id: 'job-x', status: 'running', updatedAt: 5000 });
        const text = `data: ${JSON.stringify(job)}\n`;

        const result = parseJobEvents(text, 0, 'job-x');

        expect(result.jobs).toHaveLength(1);
        expect(result.jobs[0]).toEqual(job);
        expect(result.lastSeen).toBe(5000);
        expect(result.isTerminal).toBe(false);
    });

    it('advances lastSeen to the largest updatedAt seen', () => {
        const older = makeJob({ id: 'job-1', updatedAt: 1000 });
        const newer = makeJob({ id: 'job-1', status: 'done', updatedAt: 9000 });
        const text = [
            `data: ${JSON.stringify(older)}`,
            `data: ${JSON.stringify(newer)}`,
            '',
        ].join('\n');

        const result = parseJobEvents(text, 3000, 'job-1');

        expect(result.lastSeen).toBe(9000);
        // Should never go backwards when chunk only has older timestamps.
        const stale = parseJobEvents(`data: ${JSON.stringify(older)}\n`, 8000, 'job-1');
        expect(stale.lastSeen).toBe(8000);
    });

    it('flags isTerminal when a terminal status arrives', () => {
        for (const status of TERMINAL_JOB_STATUSES) {
            const job = makeJob({ id: 'job-1', status, updatedAt: 1 });
            const result = parseJobEvents(`data: ${JSON.stringify(job)}\n`, 0, 'job-1');
            expect(result.isTerminal).toBe(true);
        }
        // non-terminal stays false
        const running = makeJob({ id: 'job-1', status: 'running', updatedAt: 1 });
        expect(
            parseJobEvents(`data: ${JSON.stringify(running)}\n`, 0, 'job-1').isTerminal,
        ).toBe(false);
        // pending is also non-terminal
        const pending = makeJob({ id: 'job-1', status: 'pending', updatedAt: 1 });
        expect(
            parseJobEvents(`data: ${JSON.stringify(pending)}\n`, 0, 'job-1').isTerminal,
        ).toBe(false);
    });

    it('ignores malformed lines, comments, event lines, and other-job events', () => {
        const other = makeJob({ id: 'job-other', status: 'running', updatedAt: 5000 });
        const mine = makeJob({ id: 'job-1', status: 'running', updatedAt: 4000 });
        const text = [
            ': keepalive comment',
            '',
            'event: job_status',
            'data: not-valid-json',
            `data: ${JSON.stringify(other)}`, // different job id — filtered out
            `data: ${JSON.stringify(mine)}`,
            'data: ', // empty payload
            '',
        ].join('\n');

        const result = parseJobEvents(text, 0, 'job-1');

        expect(result.jobs).toHaveLength(1);
        expect(result.jobs[0].id).toBe('job-1');
        // other-job's updatedAt (5000) must NOT move the cursor since it was filtered.
        expect(result.lastSeen).toBe(4000);
    });

    it('parses all jobs when no activeJobId filter is given', () => {
        const a = makeJob({ id: 'job-a', status: 'running', updatedAt: 1000 });
        const b = makeJob({ id: 'job-b', status: 'done', updatedAt: 2000 });
        const text = `data: ${JSON.stringify(a)}\ndata: ${JSON.stringify(b)}\n`;

        const result = parseJobEvents(text, 0);

        expect(result.jobs).toHaveLength(2);
        expect(result.lastSeen).toBe(2000);
        expect(result.isTerminal).toBe(true);
    });
});

describe('computeBackoff', () => {
    it('doubles the current backoff each call', () => {
        expect(computeBackoff(INITIAL_BACKOFF_MS)).toBe(2000);
        expect(computeBackoff(2000)).toBe(4000);
        expect(computeBackoff(4000)).toBe(8000);
    });

    it('caps the backoff at MAX_BACKOFF_MS', () => {
        expect(computeBackoff(MAX_BACKOFF_MS)).toBe(MAX_BACKOFF_MS);
        expect(computeBackoff(MAX_BACKOFF_MS * 4)).toBe(MAX_BACKOFF_MS);
    });
});
