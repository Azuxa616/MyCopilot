// useJobStream — SSE subscription hook for background job progress.
//
// Connects to GET /api/jobs/stream?since=<ts> with auth headers (NOT EventSource,
// which can't send custom headers), parses job-snapshot events, and reconnects
// with exponential backoff on drop. Stops automatically once the job reaches a
// terminal status (done | failed | cancelled).
//
// The pure helpers (parseJobEvents, computeBackoff, TERMINAL_JOB_STATUSES) are
// exported so they can be unit-tested without a React test renderer.
import { useEffect, useRef, useState } from 'react';
import type { Job, JobStatus } from '@my-copilot/shared';
import { fetchWithAuth } from '../../../api';

/** Cap for reconnect backoff. */
export const MAX_BACKOFF_MS = 30_000;
/** Initial reconnect backoff (also the reset value after a successful connect). */
export const INITIAL_BACKOFF_MS = 1_000;
/**
 * SSE read timeout. Chosen long enough that a healthy open stream isn't aborted
 * spuriously; the `?since=` resume param guarantees no lost events on reconnect.
 */
const STREAM_TIMEOUT_MS = 600_000;

/** Job statuses that mark completion — receiving one stops the subscription. */
export const TERMINAL_JOB_STATUSES: ReadonlyArray<JobStatus> = [
    'done',
    'failed',
    'cancelled',
];

export interface JobStreamState {
    job: Job | null;
    isConnected: boolean;
    error: string | null;
}

export interface ParseResult {
    /** Jobs parsed from this chunk, in arrival order. */
    jobs: Job[];
    /** Updated last-seen timestamp (max updatedAt seen), or the prior value. */
    lastSeen: number;
    /** True if any parsed job has a terminal status. */
    isTerminal: boolean;
}

/**
 * Parse a chunk of SSE text into job snapshots.
 *
 * Handles partial lines (buffering) by splitting on newlines and recombining the
 * trailing fragment. Recognises `data: <json>` lines; ignores `event:`, comments
 * (`:`), and blank lines. Malformed JSON is skipped silently.
 *
 * Exported for unit testing.
 */
export function parseJobEvents(
    text: string,
    priorLastSeen: number,
    activeJobId?: string,
): ParseResult {
    const jobs: Job[] = [];
    let lastSeen = priorLastSeen;
    let isTerminal = false;

    const lines = text.split('\n');
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(':')) continue; // blank or SSE comment/keepalive
        if (!line.startsWith('data:')) continue;
        const payload = line.slice('data:'.length).trim();
        if (!payload) continue;

        let data: Partial<Job>;
        try {
            data = JSON.parse(payload) as Partial<Job>;
        } catch {
            continue; // skip malformed
        }

        // When subscribed to a specific job, ignore events for other jobs.
        if (activeJobId && data.id !== activeJobId) continue;
        if (!data.id || !data.status) continue;

        const job = data as Job;
        jobs.push(job);

        if (typeof job.updatedAt === 'number' && job.updatedAt > lastSeen) {
            lastSeen = job.updatedAt;
        }
        if (TERMINAL_JOB_STATUSES.includes(job.status)) {
            isTerminal = true;
        }
    }

    return { jobs, lastSeen, isTerminal };
}

/**
 * Compute the next reconnect backoff. Doubles the current value, capped at
 * {@link MAX_BACKOFF_MS}. Exported for unit testing.
 */
export function computeBackoff(current: number): number {
    return Math.min(current * 2, MAX_BACKOFF_MS);
}

/**
 * Subscribe to job progress over SSE. Pass a jobId to track, or null to remain
 * idle. Reconnects automatically with exponential backoff; stops on terminal
 * status or unmount.
 */
export function useJobStream(jobId: string | null): JobStreamState {
    const [job, setJob] = useState<Job | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const lastSeenRef = useRef<number>(Date.now());

    useEffect(() => {
        if (!jobId) {
            setJob(null);
            setIsConnected(false);
            setError(null);
            return;
        }

        // Reset cursor so a new job subscription starts fresh.
        lastSeenRef.current = Date.now();
        setJob(null);
        setError(null);

        let active = true;
        let backoff = INITIAL_BACKOFF_MS;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let abortController: AbortController | null = null;

        const connect = async (): Promise<void> => {
            if (!active || !jobId) return;

            abortController = new AbortController();

            try {
                const response = await fetchWithAuth(
                    `/api/jobs/stream?since=${lastSeenRef.current}`,
                    {
                        headers: { Accept: 'text/event-stream' },
                        signal: abortController.signal,
                        timeout: STREAM_TIMEOUT_MS,
                    },
                );

                if (!response.body) {
                    throw new Error('Job stream response body is empty');
                }

                if (!active) return;

                setIsConnected(true);
                setError(null);
                backoff = INITIAL_BACKOFF_MS; // reset on successful connect

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (active) {
                    const { value, done } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });

                    // Split on newlines; keep the final partial line buffered.
                    const segments = buffer.split('\n');
                    buffer = segments.pop() ?? '';

                    const chunk = segments.join('\n');
                    const { jobs, lastSeen, isTerminal } = parseJobEvents(
                        chunk,
                        lastSeenRef.current,
                        jobId,
                    );

                    if (lastSeen > lastSeenRef.current) {
                        lastSeenRef.current = lastSeen;
                    }
                    for (const parsed of jobs) {
                        setJob(parsed);
                    }

                    if (isTerminal) {
                        active = false;
                        break;
                    }
                }

                try {
                    reader.releaseLock();
                } catch {
                    // ignore — reader may already be released
                }
            } catch (err) {
                if (!active) return;
                // Our own abort (unmount / jobId change) is expected — don't reconnect.
                if (abortController?.signal.aborted) return;

                setError(err instanceof Error ? err.message : String(err));
                setIsConnected(false);

                reconnectTimer = setTimeout(() => {
                    if (!active) return;
                    backoff = computeBackoff(backoff);
                    void connect();
                }, backoff);
            }
        };

        void connect();

        return () => {
            active = false;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            abortController?.abort();
        };
    }, [jobId]);

    return { job, isConnected, error };
}
