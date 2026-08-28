// RunTraceTimeline.test.tsx — 执行轨迹时间线组件（计划 todo 12）的渲染与渐进披露断言。
// 三层披露：收起摘要行 → 展开步骤列表 → 每步展开 argsPreview/resultPreview 的 pre 块。

import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import RunTraceTimeline from './RunTraceTimeline'
import type { RunStepRecord, RunTraceRecord } from '@my-copilot/shared'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 最小合法 Run 工厂，测试按需覆写。 */
function makeRun(overrides: Partial<RunTraceRecord> = {}): RunTraceRecord {
  return {
    id: 'run-1',
    sessionId: 's1',
    userMessageId: 'msg-u1',
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
    endedAt: '2026-08-29T00:00:03.500Z',
    error: null,
    ...overrides,
  }
}

/** 最小合法步骤工厂，测试按需覆写。 */
function makeStep(seq: number, overrides: Partial<RunStepRecord> = {}): RunStepRecord {
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

/** 最小渲染 helper —— 挂载时间线并返回容器。 */
function renderTimeline(run: RunTraceRecord, steps: RunStepRecord[]) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<RunTraceTimeline run={run} steps={steps} />)
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

/** 点击切换按钮并返回该按钮。 */
function clickToggle(label: string): HTMLButtonElement {
  const button = screen.getByRole('button', { name: label }) as HTMLButtonElement
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  return button
}

describe('RunTraceTimeline 摘要行（披露第一层）', () => {
  it('renders status badge, iterations, total duration and stop reason', () => {
    const { container, unmount } = renderTimeline(makeRun(), [makeStep(1)])

    expect(container.textContent).toContain('已完成')
    expect(container.textContent).toContain('2 轮')
    // endedAt - startedAt = 3500ms → 3.5s
    expect(container.textContent).toContain('3.5s')
    // stopReason end_turn 的中文文案（title 保留原始枚举值）
    expect(container.textContent).toContain('正常结束')

    unmount()
  })

  it('shows a dash for total duration when the run has no endedAt', () => {
    const { container, unmount } = renderTimeline(makeRun({ endedAt: null }), [makeStep(1)])

    expect(container.textContent).toContain('—')

    unmount()
  })

  it('hides the step list while collapsed', () => {
    const { container, unmount } = renderTimeline(makeRun(), [makeStep(1)])

    expect(container.querySelectorAll('[data-step-type]')).toHaveLength(0)
    expect(container.textContent).not.toContain('calculator')

    unmount()
  })
})

describe('RunTraceTimeline 渐进披露（第一→第二层）', () => {
  it('reveals the three steps with icons, tool names and durations on header click', () => {
    const steps = [
      makeStep(1, { type: 'llm_call', toolName: null, argsPreview: null, resultPreview: null, durationMs: 800 }),
      makeStep(2),
      makeStep(3, { toolName: 'json_format', durationMs: 5 }),
    ]
    const { container, unmount } = renderTimeline(makeRun(), steps)

    clickToggle('展开执行步骤')

    const items = container.querySelectorAll('[data-step-type]')
    expect(items).toHaveLength(3)
    // 类型图标语义：llm_call=气泡、tool_exec=扳手
    expect(items[0]?.getAttribute('data-step-type')).toBe('llm_call')
    expect(items[0]?.textContent).toContain('LLM 调用')
    expect(items[0]?.textContent).toContain('💬')
    expect(items[1]?.getAttribute('data-step-type')).toBe('tool_exec')
    expect(items[1]?.textContent).toContain('calculator')
    expect(items[1]?.textContent).toContain('🔧')
    expect(items[2]?.textContent).toContain('json_format')
    // 每步耗时
    expect(container.textContent).toContain('800ms')
    expect(container.textContent).toContain('12ms')
    expect(container.textContent).toContain('5ms')

    unmount()
  })

  it('collapses the step list again on a second click', () => {
    const { container, unmount } = renderTimeline(makeRun(), [makeStep(1)])

    clickToggle('展开执行步骤')
    expect(container.querySelectorAll('[data-step-type]')).toHaveLength(1)

    clickToggle('收起执行步骤')
    expect(container.querySelectorAll('[data-step-type]')).toHaveLength(0)

    unmount()
  })

  it('shows the error badge on isError steps only', () => {
    const steps = [
      makeStep(1),
      makeStep(2, { toolName: 'json_format', isError: true }),
    ]
    const { container, unmount } = renderTimeline(makeRun(), steps)

    clickToggle('展开执行步骤')

    const items = container.querySelectorAll('[data-step-type]')
    expect(items[0]?.textContent).not.toContain('执行出错')
    expect(items[1]?.textContent).toContain('执行出错')

    unmount()
  })

  it('shows the 无步骤记录 placeholder for an empty steps array without crashing', () => {
    const { container, unmount } = renderTimeline(makeRun(), [])

    clickToggle('展开执行步骤')

    expect(container.textContent).toContain('无步骤记录')
    expect(container.querySelectorAll('[data-step-type]')).toHaveLength(0)

    unmount()
  })
})

describe('RunTraceTimeline 每步详情（第二→第三层）', () => {
  it('expands a step to show argsPreview and resultPreview pre blocks on click', () => {
    const { container, unmount } = renderTimeline(makeRun(), [makeStep(1)])

    clickToggle('展开执行步骤')
    const stepButton = screen.getByText('calculator').closest('button') as HTMLButtonElement
    expect(stepButton).not.toBeNull()
    expect(container.querySelector('[data-step-args]')).toBeNull()

    act(() => {
      stepButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const args = container.querySelector('[data-step-args]')
    const result = container.querySelector('[data-step-result]')
    expect(args?.tagName).toBe('PRE')
    expect(args?.textContent).toContain('{"expression":"2+3"}')
    expect(result?.tagName).toBe('PRE')
    expect(result?.textContent).toContain('5')

    unmount()
  })

  it('renders only the available preview blocks (null preview omitted)', () => {
    const steps = [makeStep(1, { argsPreview: null, resultPreview: '仅结果' })]
    const { container, unmount } = renderTimeline(makeRun(), steps)

    clickToggle('展开执行步骤')
    const stepButton = screen.getByText('calculator').closest('button') as HTMLButtonElement
    act(() => {
      stepButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.querySelector('[data-step-args]')).toBeNull()
    expect(container.querySelector('[data-step-result]')?.textContent).toContain('仅结果')

    unmount()
  })

  it('disables expansion for steps without any preview', () => {
    const steps = [makeStep(1, { type: 'llm_call', toolName: null, argsPreview: null, resultPreview: null })]
    const { unmount } = renderTimeline(makeRun(), steps)

    clickToggle('展开执行步骤')
    const stepButton = screen.getByText('LLM 调用').closest('button') as HTMLButtonElement
    expect(stepButton.disabled).toBe(true)

    unmount()
  })
})
