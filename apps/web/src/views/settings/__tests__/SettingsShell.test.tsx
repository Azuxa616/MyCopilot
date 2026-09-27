// SettingsShell.test.tsx — 设置壳：五分类导航渲染、当前项高亮、demo 角色重定向。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { SettingsShell } from '../SettingsShell'
import { useConfigStore } from '../../../store/configStore'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Mounts a React element inside a MemoryRouter-driven route tree. */
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

function shellRoutes(): ReactElement {
  return (
    <MemoryRouter initialEntries={['/settings/mcps']}>
      <Routes>
        <Route path="/settings" element={<SettingsShell />}>
          <Route path="providers" element={<div data-testid="page">providers</div>} />
          <Route path="tools" element={<div data-testid="page">tools</div>} />
          <Route path="skills" element={<div data-testid="page">skills</div>} />
          <Route path="mcps" element={<div data-testid="page">mcps</div>} />
          <Route path="plugins" element={<div data-testid="page">plugins</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('SettingsShell', () => {
  beforeEach(() => {
    useConfigStore.setState({ role: 'admin' })
    vi.clearAllMocks()
  })

  it('渲染五个分类导航项并高亮当前路由', async () => {
    const { container, unmount } = await renderAsync(shellRoutes())

    const labels = Array.from(container.querySelectorAll('nav button span')).map(
      (s) => s.textContent,
    )
    expect(labels).toEqual(['模型服务', '工具', '技能', 'MCP', '插件'])

    // /settings/mcps → 「MCP」高亮
    const active = container.querySelector('nav button[aria-current="page"] span')
    expect(active?.textContent).toBe('MCP')

    // 子路由内容已渲染
    expect(container.querySelector('[data-testid="page"]')?.textContent).toBe('mcps')
    unmount()
  })

  it('demo 角色直访设置被重定向回 /', async () => {
    useConfigStore.setState({ role: 'demo' })
    // 渲染期读取 location 并渲染到 DOM（保持组件纯净，避免外层变量副作用）
    function Probe() {
      const loc = useLocation()
      return <div data-testid="probe">{loc.pathname}</div>
    }
    const { container, unmount } = await renderAsync(
      <MemoryRouter initialEntries={['/settings/mcps']}>
        <Probe />
        <Routes>
          <Route path="/settings" element={<SettingsShell />}>
            <Route path="mcps" element={null} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(container.querySelector('[data-testid="probe"]')?.textContent).toBe('/')
    unmount()
  })
})
