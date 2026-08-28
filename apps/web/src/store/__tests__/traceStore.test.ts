// apps/web/src/store/__tests__/traceStore.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useConfigStore } from '../configStore';
import { useTraceStore } from '../traceStore';
import type { RunStepRecord, RunTraceRecord } from '@my-copilot/shared';

function mockFetchOnce(status: number, body?: unknown) {
    const fn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body ?? {}), {
            status,
            // enhancedFetch 按 content-type 分支解析，缺省 Response 头是 text/plain
            headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fn);
    return fn;
}

function makeRun(overrides: Partial<RunTraceRecord> = {}): RunTraceRecord {
    return {
        id: 'run-1',
        sessionId: 's1',
        userMessageId: 'user-1',
        assistantMessageId: null,
        agentId: null,
        jobId: null,
        status: 'completed',
        stopReason: 'end_turn',
        iterations: 2,
        budgetSnapshot: null,
        degraded: false,
        totalTokens: 120,
        startedAt: '2026-08-29T00:00:00.000Z',
        endedAt: '2026-08-29T00:00:01.000Z',
        error: null,
        ...overrides,
    };
}

function makeStep(overrides: Partial<RunStepRecord> = {}): RunStepRecord {
    return {
        id: 'step-1',
        runId: 'run-1',
        seq: 1,
        type: 'tool_exec',
        toolName: 'calculator',
        argsPreview: '{"expression":"2+3"}',
        resultPreview: '5',
        isError: false,
        durationMs: 12,
        createdAt: '2026-08-29T00:00:00.500Z',
        ...overrides,
    };
}

beforeEach(() => {
    useConfigStore.setState({ authToken: 'test-token' });
    useTraceStore.setState({
        runsBySession: {},
        detailByRun: {},
        isLoadingRuns: false,
        isLoadingRunDetail: false,
        error: null,
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('traceStore.fetchRuns', () => {
    it('stores runs under the session key after a 200 response', async () => {
        const runs = [makeRun(), makeRun({ id: 'run-2', userMessageId: 'user-2' })];
        const fetchMock = mockFetchOnce(200, { data: runs });

        await useTraceStore.getState().fetchRuns('s1');

        const state = useTraceStore.getState();
        expect(state.runsBySession.s1).toEqual(runs);
        expect(state.error).toBeNull();
        expect(state.isLoadingRuns).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/sessions/s1/runs');
    });

    it('keeps per-session caches independent (no cross-session bleed)', async () => {
        const runsS1 = [makeRun()];
        const runsS2 = [makeRun({ id: 'run-s2', userMessageId: 'user-2' })];

        mockFetchOnce(200, { data: runsS1 });
        await useTraceStore.getState().fetchRuns('s1');
        mockFetchOnce(200, { data: runsS2 });
        await useTraceStore.getState().fetchRuns('s2');

        const state = useTraceStore.getState();
        expect(state.runsBySession.s1).toEqual(runsS1);
        expect(state.runsBySession.s2).toEqual(runsS2);
        expect(state.runsBySession.s2).not.toEqual(state.runsBySession.s1);
    });

    it('enters error state on HTTP 500 without throwing and without caching', async () => {
        mockFetchOnce(500);

        await expect(useTraceStore.getState().fetchRuns('s1')).resolves.toBeUndefined();

        const state = useTraceStore.getState();
        expect(state.error).not.toBeNull();
        expect(state.runsBySession.s1).toBeUndefined();
        expect(state.isLoadingRuns).toBe(false);
    });
});

describe('traceStore.getRun', () => {
    it('lazily loads steps once and serves subsequent calls from cache', async () => {
        const steps = [makeStep(), makeStep({ id: 'step-2', seq: 2, type: 'llm_call', toolName: null })];
        const fetchMock = mockFetchOnce(200, {
            data: { run: makeRun(), steps },
        });

        const first = await useTraceStore.getState().getRun('run-1');
        expect(first).toEqual({ run: makeRun(), steps });
        expect(useTraceStore.getState().detailByRun['run-1']).toEqual({ run: makeRun(), steps });

        const second = await useTraceStore.getState().getRun('run-1');
        expect(second).toEqual(first);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('enters error state on HTTP 500 without throwing and returns null', async () => {
        mockFetchOnce(500);

        const result = await useTraceStore.getState().getRun('missing-run');

        expect(result).toBeNull();
        expect(useTraceStore.getState().error).not.toBeNull();
        expect(useTraceStore.getState().isLoadingRunDetail).toBe(false);
    });
});
