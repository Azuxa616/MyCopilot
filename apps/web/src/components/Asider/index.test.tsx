// Asider/index.test.tsx — Navigation entry visibility tests.
// 「能力」/「评估」 entries render unconditionally (demo visitors must see them);
// 「设置」 section stays hidden for the demo role (role !== 'demo' gate).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

// svgr (?react) is a vite-plugin-svgr feature absent from vitest.config.ts —
// mock the icon modules so Asider renders in jsdom.
vi.mock('../../assets/icon/collapsed-left.svg?react', () => ({ default: () => null }))
vi.mock('../../assets/icon/collapsed-right.svg?react', () => ({ default: () => null }))
vi.mock('../../assets/icon/plus.svg?react', () => ({ default: () => null }))
vi.mock('../../assets/icon/ellipsis.svg?react', () => ({ default: () => null }))
vi.mock('../../assets/icon/delete.svg?react', () => ({ default: () => null }))

import Asider from './index'
import { useConfigStore } from '../../store/configStore'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Minimal render helper — mounts Asider inside a MemoryRouter and returns the container. */
function renderAsider() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <MemoryRouter>
        <Asider />
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

describe('Asider navigation entries', () => {
  beforeEach(() => {
    useConfigStore.setState({ role: null })
  })

  it('demo role: 能力/评估 entries visible, 设置 entry hidden', () => {
    useConfigStore.setState({ role: 'demo' })
    const { unmount } = renderAsider()

    expect(screen.getByText('能力对比')).not.toBeNull()
    expect(screen.getByText('评估仪表盘')).not.toBeNull()
    expect(screen.queryByText('设置')).toBeNull()
    expect(screen.queryByText('Providers')).toBeNull()

    unmount()
  })

  it('admin role: 能力/评估 and 设置 entries all visible', () => {
    useConfigStore.setState({ role: 'admin' })
    const { unmount } = renderAsider()

    expect(screen.getByText('能力对比')).not.toBeNull()
    expect(screen.getByText('评估仪表盘')).not.toBeNull()
    expect(screen.getByText('设置')).not.toBeNull()
    expect(screen.getByText('Providers')).not.toBeNull()

    unmount()
  })

  it('unknown role (null, not yet authenticated): 能力/评估 entries still render unconditionally', () => {
    const { unmount } = renderAsider()

    // 能力/评估 are not gated on role at all
    expect(screen.getByText('能力对比')).not.toBeNull()
    expect(screen.getByText('评估仪表盘')).not.toBeNull()

    unmount()
  })
})
