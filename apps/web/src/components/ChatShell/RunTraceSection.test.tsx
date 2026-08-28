// RunTraceSection.test.tsx — 「执行轨迹」折叠区与用户消息→Run 匹配语义（计划 todo 12）。
// S1-2 端到端关联断言（Oracle 兜底）：mock traceStore runs 含真实 userMessageId 后，
// 消息流中对应「用户消息」下方必须渲染出「执行轨迹」折叠区；若匹配逻辑退化为
// assistant 占位 id（run.userMessageId 装占位 id 的存量数据），用例必红。
// 注：完整 ChatShell jsdom 渲染被 TanStack Virtual 0 视口阻断（见 index.test.tsx 头注），
// 故消息流断言以 MessageList + stub virtualizer 为面——它与 ChatShell 消费同一段渲染代码。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Virtualizer } from '@tanstack/react-virtual'
import type { ReactElement } from 'react'

// svgr (?react) 是 vite-plugin-svgr 特性，vitest 未启用 —— mock 图标与头像模块。
vi.mock('../../assets/icon/retry.svg?react', () => ({ default: () => null }))
vi.mock('../../assets/icon/copy.svg?react', () => ({ default: () => null }))
vi.mock('../../assets/icon/delete.svg?react', () => ({ default: () => null }))
vi.mock('../../assets/img/avatar-ai.svg', () => ({ default: 'avatar-ai.svg' }))

// traceStore.getRun 经 api.fetchRunDetail 惰性拉取 —— mock 该函数以断言惰性语义。
vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, api: { ...actual.api, fetchRunDetail: vi.fn() } }
})

import { api, type RunTraceDetail, type RunTraceWithStepCount } from '../../api'
import { useTraceStore } from '../../store/traceStore'
import { matchRunForUserMessage } from './matchRunForUserMessage'
import RunTraceSection from './RunTraceSection'
import MessageList from './MessageList'
import type { Message, RunStepRecord, RunTraceRecord } from '@my-copilot/shared'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const fetchRunDetailMock = vi.mocked(api.fetchRunDetail)

/** 列表项 Run 工厂（GET /api/sessions/:id/runs 形状：RunTraceRecord + stepCount）。 */
function makeListRun(overrides: Partial<RunTraceRecord> = {}): RunTraceWithStepCount {
  return {
    id: 'run-1',
    sessionId: 's1',
    userMessageId: 'msg-u1',
    assistantMessageId: 'msg-a1',
    agentId: null,
    jobId: null,
    status: 'completed',
    stopReason: 'end_turn',
    iterations: 2,
    budgetSnapshot: {
      system: 600, tools: 1400, history: 3400, toolOutputs: 2800, working: 1000, headroom: 800, total: 10000,
    },
    degraded: false,
    totalTokens: 10000,
    startedAt: '2026-08-29T00:00:00.000Z',
    endedAt: '2026-08-29T00:00:03.500Z',
    error: null,
    stepCount: 3,
    ...overrides,
  }
}

function makeDetailStep(seq: number, overrides: Partial<RunStepRecord> = {}): RunStepRecord {
  return {
    id: `step-${seq}`,
    runId: 'run-1',
    seq,
    type: 'tool_exec',
    toolName: 'calculator',
    argsPreview: '{"expression":"2+3"}',
    resultPreview: '5',
    isError: false,
    durationMs: 12,
    createdAt: '2026-08-29T00:00:00.500Z',
    ...overrides,
  }
}

function userMessage(): Message {
  return {
    id: 'msg-u1',
    sessionId: 's1',
    role: 'user',
    content: '帮我算 2+3',
    attachments: [],
    status: 'sent',
    createdAt: Date.now() - 4000,
  }
}

function assistantMessage(): Message {
  return {
    id: 'msg-a1',
    sessionId: 's1',
    role: 'assistant',
    content: '结果是 5',
    attachments: [],
    status: 'sent',
    createdAt: Date.now() - 1000,
  }
}

function renderElement(element: ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

/** TanStack Virtual stub —— jsdom 0 视口下 getVirtualItems() 返回空是整组件渲染被阻断的
 * 根因；以固定两项直通渲染绕开测量，断言 MessageList 的真实渲染路径。 */
function stubVirtualizer(count: number): Virtualizer<HTMLDivElement, Element> {
  const items = Array.from({ length: count }, (_, index) => ({
    index,
    start: index * 100,
    end: (index + 1) * 100,
    size: 100,
    key: index,
  }))
  return {
    getVirtualItems: () => items,
    getTotalSize: () => count * 100,
    measureElement: () => {},
  } as unknown as Virtualizer<HTMLDivElement, Element>
}

beforeEach(() => {
  fetchRunDetailMock.mockReset()
  useTraceStore.setState({
    runsBySession: {},
    detailByRun: {},
    isLoadingRuns: false,
    isLoadingRunDetail: false,
    error: null,
  })
})

describe('matchRunForUserMessage 匹配语义（S1-2 核心）', () => {
  it('matches a run by the real user message id, never the assistant placeholder id', () => {
    const run = makeListRun({ userMessageId: 'msg-u1', assistantMessageId: 'msg-a1' })

    expect(matchRunForUserMessage([run], 'msg-u1')?.id).toBe('run-1')
    // 匹配逻辑若退化为 assistant 占位 id，此断言必红（占位 id 不得命中）
    expect(matchRunForUserMessage([run], 'msg-a1')).toBeUndefined()
  })

  it('picks the latest run when a user message triggered several (list is started_at desc)', () => {
    const older = makeListRun({ id: 'run-old', startedAt: '2026-08-29T00:00:01.000Z' })
    const newer = makeListRun({ id: 'run-new', startedAt: '2026-08-29T00:00:02.000Z' })

    expect(matchRunForUserMessage([newer, older], 'msg-u1')?.id).toBe('run-new')
  })

  it('returns undefined for missing or empty run lists', () => {
    expect(matchRunForUserMessage(undefined, 'msg-u1')).toBeUndefined()
    expect(matchRunForUserMessage([], 'msg-u1')).toBeUndefined()
    expect(matchRunForUserMessage([makeListRun({ userMessageId: 'msg-other' })], 'msg-u1')).toBeUndefined()
  })
})

describe('RunTraceSection 折叠区', () => {
  it('renders the collapsed 执行轨迹 region for a user message with a matching run (S1-2)', () => {
    useTraceStore.setState({ runsBySession: { s1: [makeListRun()] } })

    const { container, unmount } = renderElement(<RunTraceSection message={userMessage()} />)

    expect(container.textContent).toContain('执行轨迹')
    expect(container.textContent).toContain('3 步')
    // 默认收起：不出现时间线摘要与预算条
    expect(container.textContent).not.toContain('已完成')
    expect(container.querySelector('[data-budget-meter]')).toBeNull()

    unmount()
  })

  it('renders nothing when runs only reference the assistant placeholder id (匹配退化必红)', () => {
    // run.userMessageId 装的是 assistant 占位 id：真实用户消息下方不得渲染折叠区
    useTraceStore.setState({ runsBySession: { s1: [makeListRun({ userMessageId: 'msg-a1' })] } })

    const { container, unmount } = renderElement(<RunTraceSection message={userMessage()} />)

    expect(container.innerHTML).toBe('')

    unmount()
  })

  it('renders nothing for a session with no cached runs', () => {
    const { container, unmount } = renderElement(<RunTraceSection message={userMessage()} />)

    expect(container.innerHTML).toBe('')

    unmount()
  })

  it('lazy-loads the run detail on expand and renders Timeline + BudgetMeter', async () => {
    const detail: RunTraceDetail = {
      run: makeListRun(),
      steps: [
        makeDetailStep(1, { type: 'llm_call', toolName: null, argsPreview: null, resultPreview: null }),
        makeDetailStep(2),
        makeDetailStep(3, { toolName: 'json_format' }),
      ],
    }
    fetchRunDetailMock.mockResolvedValue(detail)
    useTraceStore.setState({ runsBySession: { s1: [makeListRun()] } })

    const { container, unmount } = renderElement(<RunTraceSection message={userMessage()} />)
    expect(fetchRunDetailMock).not.toHaveBeenCalled()

    const header = screen.getByRole('button', { name: '展开执行轨迹' }) as HTMLButtonElement
    await act(async () => {
      header.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // 惰性拉取：展开时才请求一次该 run 的详情
    expect(fetchRunDetailMock).toHaveBeenCalledTimes(1)
    expect(fetchRunDetailMock).toHaveBeenCalledWith('run-1')
    // 时间线摘要行与六桶预算条均已渲染
    expect(container.querySelector('[data-run-trace-timeline]')).not.toBeNull()
    expect(container.querySelectorAll('[data-bucket]')).toHaveLength(6)

    unmount()
  })

  it('skips the BudgetMeter when budgetSnapshot is null (占位不崩溃)', async () => {
    const detail: RunTraceDetail = {
      run: makeListRun({ budgetSnapshot: null }),
      steps: [makeDetailStep(1)],
    }
    fetchRunDetailMock.mockResolvedValue(detail)
    useTraceStore.setState({ runsBySession: { s1: [makeListRun({ budgetSnapshot: null })] } })

    const { container, unmount } = renderElement(<RunTraceSection message={userMessage()} />)
    const header = screen.getByRole('button', { name: '展开执行轨迹' }) as HTMLButtonElement
    await act(async () => {
      header.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.querySelector('[data-run-trace-timeline]')).not.toBeNull()
    expect(container.querySelector('[data-budget-meter]')).toBeNull()

    unmount()
  })

  it('shows the failure hint instead of an infinite loading state when the detail fetch fails', async () => {
    fetchRunDetailMock.mockRejectedValue(new Error('boom'))
    useTraceStore.setState({ runsBySession: { s1: [makeListRun()] } })

    const { container, unmount } = renderElement(<RunTraceSection message={userMessage()} />)
    const header = screen.getByRole('button', { name: '展开执行轨迹' }) as HTMLButtonElement
    await act(async () => {
      header.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('轨迹加载失败')

    unmount()
  })
})

describe('消息流集成（MessageList + stub virtualizer，S1-2 端到端关联）', () => {
  it('renders the 执行轨迹 region below the matching user message only', () => {
    useTraceStore.setState({ runsBySession: { s1: [makeListRun()] } })
    const messages = [userMessage(), assistantMessage()]

    const { container, unmount } = renderElement(
      <MessageList
        messages={messages}
        virtualizer={stubVirtualizer(messages.length)}
        containerRef={{ current: document.createElement('div') }}
        onRegenerate={() => {}}
      />,
    )

    const userItem = container.querySelector('div[data-index="0"]')
    const assistantItem = container.querySelector('div[data-index="1"]')
    expect(userItem).not.toBeNull()
    expect(assistantItem).not.toBeNull()

    // 用户消息下方出现折叠区；助手消息下方没有
    expect(userItem?.textContent).toContain('执行轨迹')
    expect(assistantItem?.textContent).not.toContain('执行轨迹')

    // 折叠区位于用户消息卡片之后（DOM 顺序 = 视觉顺序「下方」）
    const card = userItem?.querySelector('[role="article"]') ?? null
    const section = userItem?.querySelector('[data-run-trace-section]') ?? null
    expect(card).not.toBeNull()
    expect(section).not.toBeNull()
    const follows = (card as Node).compareDocumentPosition(section as Node) & Node.DOCUMENT_POSITION_FOLLOWING
    expect(follows).toBeTruthy()

    unmount()
  })

  it('renders no 执行轨迹 region for user messages without a matching run', () => {
    useTraceStore.setState({ runsBySession: { s1: [makeListRun({ userMessageId: 'msg-other' })] } })
    const messages = [userMessage(), assistantMessage()]

    const { container, unmount } = renderElement(
      <MessageList
        messages={messages}
        virtualizer={stubVirtualizer(messages.length)}
        containerRef={{ current: document.createElement('div') }}
        onRegenerate={() => {}}
      />,
    )

    expect(container.textContent).not.toContain('执行轨迹')

    unmount()
  })
})
