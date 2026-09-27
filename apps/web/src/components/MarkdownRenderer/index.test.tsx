// MarkdownRenderer 测试：img referrerPolicy + 通用插件卡片围栏块拦截。
// PluginCardHost 的渲染握手细节由其自身测试覆盖；此处 mock api 让宿主渲染 iframe。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'
import MarkdownRenderer from './index'

const { fetchPluginFrontendMock } = vi.hoisted(() => ({
  fetchPluginFrontendMock: vi.fn(),
}))

vi.mock('../../api', () => ({
  api: { fetchPluginFrontend: fetchPluginFrontendMock },
}))

// svgr 的 ?react 资产在 jsdom 下无法解析，mock 为空组件（旧语言回退代码框时用到复制按钮图标）。
vi.mock('../../assets/icon/copy.svg?react', () => ({ default: () => null }))

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

describe('MarkdownRenderer img', () => {
  it('外链图片带 referrerPolicy=no-referrer（防图床防盗链 403）', async () => {
    const { container, unmount } = await renderAsync(
      <MarkdownRenderer
        content={
          '![封面](https://i2.hdslb.com/bfs/archive/1539eda078e41a9cdcd5509091bf391d3b1503f9.jpg)'
        }
      />,
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(img?.getAttribute('alt')).toBe('封面')
    expect(img?.getAttribute('loading')).toBe('lazy')
    unmount()
  })
})

describe('MarkdownRenderer 插件卡片围栏块（<pluginId>:card）', () => {
  beforeEach(() => {
    fetchPluginFrontendMock.mockReset()
    fetchPluginFrontendMock.mockResolvedValue('<!doctype html><html><body>r</body></html>')
  })

  it('合法围栏块渲染为插件卡片宿主，且不包代码框', async () => {
    const { container, unmount } = await renderAsync(
      <MarkdownRenderer content={'```demo-plugin:card\n{"cards":[{"bvid":"BV1"}]}\n```'} />,
    )
    const host = container.querySelector('[data-testid="plugin-card-host"]')
    expect(host).not.toBeNull()
    expect(host?.getAttribute('data-plugin-id')).toBe('demo-plugin')
    // 不应出现代码框（复制按钮 / data-language 头）
    expect(container.querySelector('[data-language]')).toBeNull()
    expect(container.querySelector('button[aria-label="复制代码"]')).toBeNull()
    unmount()
  })

  it('载荷非法 JSON 仍交给渲染器；旧 bilibili-card 语言不拦截（无兼容垫片）', async () => {
    const { container, unmount } = await renderAsync(
      <MarkdownRenderer content={'```demo-plugin:card\nnot-json\n```'} />,
    )
    expect(container.querySelector('[data-testid="plugin-card-host"]')).not.toBeNull()
    unmount()

    const { container: c2, unmount: u2 } = await renderAsync(
      <MarkdownRenderer content={'```bilibili-card\n{}\n```'} />,
    )
    expect(c2.querySelector('[data-testid="plugin-card-host"]')).toBeNull()
    expect(c2.querySelector('code')).not.toBeNull()
    u2()
  })

  it('入口拉取失败时渲染兜底卡片', async () => {
    fetchPluginFrontendMock.mockRejectedValue(new Error('409'))
    // 用独立插件 id，避免撞上模块级渲染器缓存（demo-plugin 已在前序用例缓存成功）
    const { container, unmount } = await renderAsync(
      <MarkdownRenderer content={'```ghost-plugin:card\n{}\n```'} />,
    )
    expect(container.querySelector('[data-testid="plugin-card-fallback"]')).not.toBeNull()
    unmount()
  })
})

