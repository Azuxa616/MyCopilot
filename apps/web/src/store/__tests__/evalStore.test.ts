// apps/web/src/store/__tests__/evalStore.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useConfigStore } from '../configStore';
import { useEvalStore } from '../evalStore';
import type { EvalRunResult, EvalSnapshot } from '@my-copilot/shared';

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

function makeRunResult(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
    return {
        scenarioId: 'multi-step-tool-chain',
        mode: 'deterministic',
        status: 'pass',
        metrics: { steps_used: 2 },
        faultType: null,
        runTraceId: 'run-1',
        assertionResults: [{ kind: 'status', pass: true, detail: 'completed' }],
        ...overrides,
    };
}

function makeSnapshot(overrides: Partial<EvalSnapshot> = {}): EvalSnapshot {
    return {
        generatedAt: '2026-08-29T00:00:00.000Z',
        gitCommit: 'abc1234',
        scenarios: [makeRunResult()],
        aggregate: { passRate: 1, avgSteps: 2, recoveryRate: 1 },
        ...overrides,
    };
}

beforeEach(() => {
    useConfigStore.setState({ authToken: 'test-token' });
    useEvalStore.setState({
        snapshot: null,
        scenarios: [],
        replayResult: null,
        isLoadingSnapshot: false,
        isLoadingScenarios: false,
        isReplaying: false,
        error: null,
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('evalStore.fetchSnapshot', () => {
    it('stores the snapshot after a 200 response', async () => {
        const snapshot = makeSnapshot();
        const fetchMock = mockFetchOnce(200, { data: snapshot });

        await useEvalStore.getState().fetchSnapshot();

        const state = useEvalStore.getState();
        expect(state.snapshot).toEqual(snapshot);
        expect(state.error).toBeNull();
        expect(state.isLoadingSnapshot).toBe(false);
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/eval/snapshot');
    });

    it('enters error state on HTTP 500 without throwing', async () => {
        mockFetchOnce(500);

        await expect(useEvalStore.getState().fetchSnapshot()).resolves.toBeUndefined();

        const state = useEvalStore.getState();
        expect(state.error).not.toBeNull();
        expect(state.snapshot).toBeNull();
        expect(state.isLoadingSnapshot).toBe(false);
    });
});

describe('evalStore.fetchScenarios', () => {
    it('stores the scenario metadata list after a 200 response', async () => {
        const scenarios = [
            {
                id: 'multi-step-tool-chain',
                name: '多步工具链',
                description: '两轮 LLM 调用串起 calculator 与 json_format',
                category: 'loop',
                mode: 'deterministic',
                replayable: true,
            },
        ];
        const fetchMock = mockFetchOnce(200, { data: scenarios });

        await useEvalStore.getState().fetchScenarios();

        const state = useEvalStore.getState();
        expect(state.scenarios).toEqual(scenarios);
        expect(state.error).toBeNull();
        expect(state.isLoadingScenarios).toBe(false);
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/eval/scenarios');
    });
});

describe('evalStore.replayScenario', () => {
    it('stores the replay result and resets isReplaying after a 200 response', async () => {
        const replay = {
            runTrace: {
                id: 'run-1',
                sessionId: 'eval-session',
                userMessageId: 'user-1',
                assistantMessageId: null,
                agentId: null,
                jobId: null,
                status: 'completed',
                stopReason: 'end_turn',
                iterations: 2,
                budgetSnapshot: null,
                degraded: false,
                totalTokens: 80,
                startedAt: '2026-08-29T00:00:00.000Z',
                endedAt: '2026-08-29T00:00:01.000Z',
                error: null,
            },
            steps: [
                {
                    id: 'step-1',
                    runId: 'run-1',
                    seq: 1,
                    type: 'tool_exec',
                    toolName: 'calculator',
                    argsPreview: '{"expression":"2+3"}',
                    resultPreview: '5',
                    isError: false,
                    durationMs: 9,
                    createdAt: '2026-08-29T00:00:00.400Z',
                },
            ],
            evalRun: makeRunResult(),
        };
        const fetchMock = mockFetchOnce(200, { data: replay });

        await useEvalStore.getState().replayScenario('multi-step-tool-chain');

        const state = useEvalStore.getState();
        expect(state.replayResult).toEqual(replay);
        expect(state.isReplaying).toBe(false);
        expect(state.error).toBeNull();
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
            '/api/eval/scenarios/multi-step-tool-chain/replay',
        );
    });

    it('enters error state on HTTP 500 without throwing and clears isReplaying', async () => {
        mockFetchOnce(500);

        await expect(
            useEvalStore.getState().replayScenario('multi-step-tool-chain'),
        ).resolves.toBeUndefined();

        const state = useEvalStore.getState();
        expect(state.error).not.toBeNull();
        expect(state.replayResult).toBeNull();
        expect(state.isReplaying).toBe(false);
    });
});
