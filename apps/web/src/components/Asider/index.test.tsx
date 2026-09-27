// Asider footer 测试：admin 仅一个「设置」入口；demo 隐藏。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import Asider from './index'
import { useConfigStore } from '../../store/configStore'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// svgr 的 ?react 资产在 jsdom 下无法解析，mock 为空组件（测试只关心 footer 逻辑）。
vi.mock('../../assets/icon/collapsed-left.svg?react', () => ({ default: () => null }))
vi.mock('../../assets/icon/collapsed-right.svg?react', () => ({ default: () => null }))
vi.mock('../../assets/icon/plus.svg?react', () => ({ default: () => null }))

async function renderAsync(ui: ReactElement): Promise<{
  container: HTMLElement
  unmount: () => void
}> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(ui)
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe('Asider footer', () => {
  beforeEach(() => {
    useConfigStore.setState({ role: 'admin' })
    vi.clearAllMocks()
  })

  it('admin：footer 仅一个设置入口，不再有四个一级导航', async () => {
    const { container, unmount } = await renderAsync(
      <MemoryRouter>
        <Asider />
      </MemoryRouter>,
    )
    const footerButtons = Array.from(container.querySelectorAll('footer button'))
    expect(footerButtons.length).toBe(1)
    expect(footerButtons[0].textContent).toContain('设置')
    unmount()
  })

  it('demo：设置入口隐藏', async () => {
    useConfigStore.setState({ role: 'demo' })
    const { container, unmount } = await renderAsync(
      <MemoryRouter>
        <Asider />
      </MemoryRouter>,
    )
    expect(container.querySelectorAll('footer button').length).toBe(0)
    unmount()
  })
})
