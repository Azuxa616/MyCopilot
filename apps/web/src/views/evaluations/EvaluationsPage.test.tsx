// EvaluationsPage.test.tsx — 评估仪表盘渲染与现场回放交互测试。
// 快照渲染（指标卡/表格/脚注）、行展开断言明细、现场回放交互（成功渲染
// RunTraceTimeline + ContextBudgetMeter；429 失败复位并提示）、空快照引导、
// live 场景不提供回放按钮。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

import { EvaluationsPage } from './EvaluationsPage'
import { useEvalStore } from '../../store/evalStore'
import { useConfigStore } from '../../store/configStore'
import type { EvalReplayResult } from '../../api'
import type { EvalSnapshot, EvalRunResult, RunStepRecord, RunTraceRecord } from '@my-copilot/shared'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ─── Fixtures ───

function makeRunResult(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
    return {
        scenarioId: 'multi-step-tool-chain',
        mode: 'deterministic',
        status: 'pass',
        metrics: { steps_used: 2 },
        faultType: null,
        runTraceId: 'run-1',
        assertionResults: [{ kind: 'status', pass: true, detail: 'status=completed' }],
        ...overrides,
    }
}

function makeSnapshot(): EvalSnapshot {
    return {
        generatedAt: '2026-08-29T00:00:00.000Z',
        gitCommit: 'abcdef1234567890',
        scenarios: [
            makeRunResult({
                scenarioId: 'multi-step-tool-chain',
                assertionResults: [
                    { kind: 'status', pass: true, detail: 'status=completed' },
                    { kind: 'tool_sequence', pass: true, detail: 'calculator,json_format' },
                ],
            }),
            makeRunResult({
                scenarioId: 'live-weather-task',
                mode: 'live',
                status: 'fail',
                faultType: 'goal_incomplete',
                assertionResults: [{ kind: 'final_contains', pass: false, detail: '结果未包含天气结论' }],
            }),
        ],
        aggregate: { passRate: 0.5, avgSteps: 2.5, recoveryRate: 1 },
    }
}

const SCENARIO_METAS = [
    {
        id: 'multi-step-tool-chain',
        name: '多步工具链',
        description: '两轮 LLM 调用串起 calculator 与 json_format',
        category: 'task',
        mode: 'deterministic',
        replayable: true,
    },
    {
        id: 'live-weather-task',
        name: '真实模型任务',
        description: '真实 LLM 跑 3 次统计 pass^k',
        category: 'task',
        mode: 'live',
        replayable: false,
    },
] as const

function makeReplayResult(): EvalReplayResult {
    const runTrace: RunTraceRecord = {
        id: 'run-replay-1',
        sessionId: 'eval-session',
        userMessageId: 'user-1',
        assistantMessageId: null,
        agentId: null,
        jobId: null,
        status: 'completed',
        stopReason: 'end_turn',
        iterations: 2,
        budgetSnapshot: { system: 10, tools: 20, history: 30, toolOutputs: 5, working: 10, headroom: 25, total: 100 },
        degraded: false,
        totalTokens: 80,
        startedAt: '2026-08-29T00:00:00.000Z',
        endedAt: '2026-08-29T00:00:01.000Z',
        error: null,
    }
    const steps: RunStepRecord[] = [
        {
            id: 'step-1',
            runId: 'run-replay-1',
            seq: 1,
            type: 'tool_exec',
            toolName: 'calculator',
            argsPreview: '{"expression":"2+3"}',
            resultPreview: '5',
            isError: false,
            durationMs: 9,
            createdAt: '2026-08-29T00:00:00.400Z',
        },
        {
            id: 'step-2',
            runId: 'run-replay-1',
            seq: 2,
            type: 'llm_call',
            toolName: null,
            argsPreview: null,
            resultPreview: null,
            isError: false,
            durationMs: 30,
            createdAt: '2026-08-29T00:00:00.800Z',
        },
    ]
    return { runTrace, steps, evalRun: makeRunResult() }
}

// ─── Fetch stubbing（按 URL 分发，覆盖 mount 期两条请求 + 回放请求） ───

interface StubRoutes {
    snapshot?: unknown
    scenarios?: unknown
    replay?: { status: number; body?: unknown }
}

const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function stubEvalFetch(routes: StubRoutes = {}) {
    return vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/replay')) {
            const replay = routes.replay ?? { status: 200, body: makeReplayResult() }
            return Promise.resolve(jsonResponse(replay.status, { data: replay.body ?? makeReplayResult() }))
        }
        if (url.includes('/api/eval/snapshot')) {
            return Promise.resolve(jsonResponse(200, { data: routes.snapshot ?? makeSnapshot() }))
        }
        if (url.includes('/api/eval/scenarios')) {
            return Promise.resolve(jsonResponse(200, { data: routes.scenarios ?? SCENARIO_METAS }))
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
}

// ─── Render helper ───

async function renderEvaluationsPage() {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
        root.render(
            <MemoryRouter>
                <EvaluationsPage />
            </MemoryRouter>,
        )
    })
    return {
        container,
        unmount: () => {
            act(() => root.unmount())
            container.remove()
        },
    }
}

// ─── Tests ───

beforeEach(() => {
    useConfigStore.setState({ authToken: 'test-token' })
    useEvalStore.setState({
        snapshot: null,
        scenarios: [],
        replayResult: null,
        isLoadingSnapshot: false,
        isLoadingScenarios: false,
        isReplaying: false,
        error: null,
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('EvaluationsPage', () => {
    it('renders metric cards, scenario table rows and snapshot footer from the snapshot', async () => {
        vi.stubGlobal('fetch', stubEvalFetch())
        const { container, unmount } = await renderEvaluationsPage()

        // 指标卡：passRate 50%、场景总数 2、平均步数 2.5、恢复率 100%
        expect(container.querySelector('[data-metric-card="passRate"]')?.textContent).toContain('50%')
        expect(container.querySelector('[data-metric-card="scenarioCount"]')?.textContent).toContain('2')
        expect(container.querySelector('[data-metric-card="avgSteps"]')?.textContent).toContain('2.5')
        expect(container.querySelector('[data-metric-card="recoveryRate"]')?.textContent).toContain('100%')

        // 两行场景，含名称与 id
        const rows = container.querySelectorAll('[data-eval-row]')
        expect(rows.length).toBe(2)
        expect(screen.getByText('多步工具链')).not.toBeNull()
        expect(screen.getByText('真实模型任务')).not.toBeNull()
        expect(screen.getByText('multi-step-tool-chain')).not.toBeNull()

        // 脚注元信息：gitCommit 短哈希（前 7 位）
        const footer = container.querySelector('[data-snapshot-meta]')
        expect(footer?.textContent).toContain('abcdef1')
        expect(footer?.textContent).not.toContain('abcdef1234567890')

        unmount()
    })

    it('expands assertion details when a scenario row is clicked', async () => {
        vi.stubGlobal('fetch', stubEvalFetch())
        const { container, unmount } = await renderEvaluationsPage()

        // 初始无断言明细
        expect(container.querySelector('[data-assertion-detail]')).toBeNull()

        await act(async () => {
            fireEvent.click(container.querySelector('[data-eval-row="multi-step-tool-chain"]') as HTMLElement)
        })

        const detail = container.querySelector('[data-assertion-detail="multi-step-tool-chain"]')
        expect(detail).not.toBeNull()
        expect(screen.getByText('工具序列')).not.toBeNull()
        expect(screen.getByText('calculator,json_format')).not.toBeNull()

        // 其他行未展开
        expect(container.querySelector('[data-assertion-detail="live-weather-task"]')).toBeNull()

        unmount()
    })

    it('renders the replayed trace via RunTraceTimeline and ContextBudgetMeter after clicking 现场回放', async () => {
        vi.stubGlobal('fetch', stubEvalFetch())
        const { container, unmount } = await renderEvaluationsPage()

        expect(container.querySelector('[data-replay-panel]')).toBeNull()

        await act(async () => {
            fireEvent.click(container.querySelector('[data-replay-button="multi-step-tool-chain"]') as HTMLElement)
        })

        // 回放面板出现并标注场景 id；预算仪表渲染（budgetSnapshot 非空）
        const panel = container.querySelector('[data-replay-panel]')
        expect(panel).not.toBeNull()
        expect(panel?.textContent).toContain('multi-step-tool-chain')
        expect(container.querySelector('[data-budget-meter]')).not.toBeNull()

        // RunTraceTimeline 出现；展开后步骤数与 mock 一致（2）
        expect(container.querySelector('[data-run-trace-timeline]')).not.toBeNull()
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '展开执行步骤' }))
        })
        const stepItems = container.querySelectorAll('[data-step-type]')
        expect(stepItems.length).toBe(2)

        unmount()
    })

    it('shows the guide text when the snapshot is empty (no report generated)', async () => {
        vi.stubGlobal('fetch', stubEvalFetch({ snapshot: { scenarios: [], generatedAt: null } }))
        const { container, unmount } = await renderEvaluationsPage()

        expect(screen.getByText('运行 pnpm eval -- --report 生成快照')).not.toBeNull()
        expect(container.querySelector('[data-eval-row]')).toBeNull()
        expect(container.querySelector('[data-metric-card="passRate"]')).toBeNull()

        unmount()
    })

    it('does not render a replay button for live scenarios', async () => {
        vi.stubGlobal('fetch', stubEvalFetch())
        const { container, unmount } = await renderEvaluationsPage()

        expect(container.querySelector('[data-replay-button="live-weather-task"]')).toBeNull()
        expect(container.querySelector('[data-replay-button="multi-step-tool-chain"]')).not.toBeNull()

        unmount()
    })

    it('resets the replay button and shows an error alert on HTTP 429 without crashing', async () => {
        vi.stubGlobal('fetch', stubEvalFetch({ replay: { status: 429, body: { error: 'too many replays' } } }))
        const { container, unmount } = await renderEvaluationsPage()

        const button = container.querySelector('[data-replay-button="multi-step-tool-chain"]') as HTMLButtonElement
        await act(async () => {
            fireEvent.click(button)
        })

        // 按钮态复位（不再禁用），错误横幅出现，页面未崩溃
        expect(button.disabled).toBe(false)
        expect(button.textContent).toContain('现场回放')
        const alert = container.querySelector('[role="alert"]')
        expect(alert).not.toBeNull()
        expect(alert?.textContent?.length ?? 0).toBeGreaterThan(0)
        expect(container.querySelector('[data-replay-panel]')).toBeNull()
        expect(container.querySelectorAll('[data-eval-row]').length).toBe(2)

        unmount()
    })
})
