// CapabilitiesPage.test.tsx — Static capability showcase page rendering tests.
// Asserts the three showcase sections render from hardcoded constants:
// comparison table (8 rows), Run state machine (8 capsules), safety levels (3 cards).

import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

import { CapabilitiesPage } from './CapabilitiesPage'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Minimal render helper — mounts the page inside a MemoryRouter and returns the container. */
function renderCapabilitiesPage() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <MemoryRouter>
        <CapabilitiesPage />
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

/** The 8 RunStatus names verbatim from packages/shared/src/run.ts:21-29. */
const RUN_STATUSES = [
  'queued',
  'in_progress',
  'requires_action',
  'completed',
  'cancelled',
  'failed',
  'incomplete',
  'expired',
] as const

describe('CapabilitiesPage', () => {
  it('renders the Runtime vs 普通 AI Chat comparison table with 8 rows', () => {
    const { container, unmount } = renderCapabilitiesPage()

    // Table header names both sides of the comparison
    expect(screen.getByText('MyCopilot Runtime')).not.toBeNull()
    expect(screen.getByText('普通 AI Chat')).not.toBeNull()

    // Exactly 8 comparison rows
    const rows = container.querySelectorAll('[data-capability-row]')
    expect(rows.length).toBe(8)

    // Spot-check every dimension label appears once
    for (const label of [
      'SSE 流式协议',
      '六桶上下文预算',
      '三级工具安全',
      'Run 状态机',
      'LoopGuard 防死循环',
      '扩展机制',
      '长任务执行',
      '双 token 访问控制',
    ]) {
      expect(screen.getByText(label)).not.toBeNull()
    }

    unmount()
  })

  it('renders the Run state machine with 8 capsules using RunStatus names verbatim', () => {
    const { container, unmount } = renderCapabilitiesPage()

    const capsules = container.querySelectorAll('[data-run-state]')
    expect(capsules.length).toBe(8)

    const names = Array.from(capsules).map((el) => el.textContent ?? '')
    for (const status of RUN_STATUSES) {
      expect(names.filter((n) => n.includes(status)).length).toBe(1)
    }

    unmount()
  })

  it('renders three safety level cards and the two-step confirmation flow', () => {
    const { container, unmount } = renderCapabilitiesPage()

    const cards = container.querySelectorAll('[data-safety-level]')
    expect(cards.length).toBe(3)

    const levels = Array.from(cards).map((el) => el.getAttribute('data-safety-level'))
    expect(levels).toContain('safe')
    expect(levels).toContain('restricted')
    expect(levels).toContain('danger')

    // Confirmation flow explains both steps
    expect(screen.getByText('第 1 步')).not.toBeNull()
    expect(screen.getByText('第 2 步')).not.toBeNull()

    unmount()
  })
})
