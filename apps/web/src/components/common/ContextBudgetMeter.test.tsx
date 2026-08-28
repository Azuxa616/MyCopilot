// ContextBudgetMeter.test.tsx — 六桶上下文预算仪表（计划 todo 12）的渲染断言。
// 桶宽 = tokens/total（纯 CSS flex 百分比），六桶顺序固定：
// system → tools → history → toolOutputs → working → headroom。

import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import ContextBudgetMeter from './ContextBudgetMeter'
import type { BudgetBreakdown } from '@my-copilot/shared'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeBudget(overrides: Partial<BudgetBreakdown> = {}): BudgetBreakdown {
  return {
    system: 600,
    tools: 1400,
    history: 3400,
    toolOutputs: 2800,
    working: 1000,
    headroom: 800,
    total: 10000,
    ...overrides,
  }
}

function renderMeter(budget: BudgetBreakdown, degraded = false) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<ContextBudgetMeter budget={budget} degraded={degraded} />)
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

/** 解析六桶分段的内联宽度百分比为数字数组。 */
function segmentWidths(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('[data-bucket]'), (el) =>
    parseFloat((el as HTMLElement).style.width),
  )
}

describe('ContextBudgetMeter 六桶堆叠条', () => {
  it('renders six bucket segments in the fixed order with widths summing to 100 (±0.5)', () => {
    const { container, unmount } = renderMeter(makeBudget())

    const names = Array.from(container.querySelectorAll('[data-bucket]'), (el) =>
      (el as HTMLElement).dataset.bucket,
    )
    expect(names).toEqual(['system', 'tools', 'history', 'toolOutputs', 'working', 'headroom'])

    const widths = segmentWidths(container)
    expect(widths).toHaveLength(6)
    expect(Math.abs(widths.reduce((acc, w) => acc + w, 0) - 100)).toBeLessThan(0.5)

    unmount()
  })

  it('computes each bucket width as tokens/total', () => {
    const { container, unmount } = renderMeter(makeBudget())

    const widths = segmentWidths(container)
    expect(widths[0]).toBeCloseTo(6, 1) // system 600/10000
    expect(widths[1]).toBeCloseTo(14, 1) // tools 1400/10000
    expect(widths[2]).toBeCloseTo(34, 1) // history 3400/10000
    expect(widths[3]).toBeCloseTo(28, 1) // toolOutputs 2800/10000
    expect(widths[4]).toBeCloseTo(10, 1) // working 1000/10000
    expect(widths[5]).toBeCloseTo(8, 1) // headroom 800/10000

    unmount()
  })

  it('labels each bucket with its token count plus the total', () => {
    const { container, unmount } = renderMeter(makeBudget())

    const text = container.textContent ?? ''
    for (const label of ['系统', '工具', '历史', '工具输出', '当前轮', '预留']) {
      expect(text).toContain(label)
    }
    expect(text).toContain('600')
    expect(text).toContain('1400')
    expect(text).toContain('3400')
    expect(text).toContain('2800')
    expect(text).toContain('1000')
    expect(text).toContain('800')
    expect(text).toContain('10000')

    unmount()
  })
})

describe('ContextBudgetMeter degraded 徽标', () => {
  it('shows the amber degraded badge when degraded is true', () => {
    const { container, unmount } = renderMeter(makeBudget(), true)

    const badge = container.querySelector('[data-degraded-badge]')
    expect(badge?.textContent).toContain('降级')
    expect(badge?.className).toContain('bg-warning-light')

    unmount()
  })

  it('shows no degraded badge by default', () => {
    const { container, unmount } = renderMeter(makeBudget())

    expect(container.querySelector('[data-degraded-badge]')).toBeNull()

    unmount()
  })
})

describe('ContextBudgetMeter 边界（malformed input 兜底）', () => {
  it('renders zero-width segments without NaN for an all-zero budget', () => {
    const { container, unmount } = renderMeter(
      makeBudget({ system: 0, tools: 0, history: 0, toolOutputs: 0, working: 0, headroom: 0, total: 0 }),
    )

    const widths = segmentWidths(container)
    expect(widths).toHaveLength(6)
    for (const width of widths) {
      expect(Number.isNaN(width)).toBe(false)
      expect(width).toBe(0)
    }
    expect(container.textContent).toContain('0')

    unmount()
  })
})
