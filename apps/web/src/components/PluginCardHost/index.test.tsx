// PluginCardHost 测试：提取器协议、渲染握手（rendered/error/超时/open）、兜底卡片。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'
import PluginCardHost from './index'
import { extractCardPayload } from './parse'

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { fetchPluginFrontendMock } = vi.hoisted(() => ({
  fetchPluginFrontendMock: vi.fn(),
}))

vi.mock('../../api', () => ({
  api: { fetchPluginFrontend: fetchPluginFrontendMock },
}))

const RENDERER_HTML = '<!doctype html><html><body>renderer</body></html>'

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

/** 以 iframe.contentWindow 为 source 派发一条渲染器消息（自动附带宿主 data-request-id）。 */
function dispatchFromIframe(container: HTMLElement, data: Record<string, unknown>) {
  const wrapper = container.querySelector('[data-testid="plugin-card-host"]')
  const requestId = wrapper?.getAttribute('data-request-id')
  const iframe = container.querySelector('iframe')
  expect(iframe).not.toBeNull()
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { source: iframe!.contentWindow, data: { ...data, requestId } }),
    )
  })
}

function currentRequestId(container: HTMLElement): string | undefined {
  return container.querySelector('[data-testid="plugin-card-host"]')?.getAttribute('data-request-id') ?? undefined
}

describe('extractCardPayload', () => {
  const fence = '```demo-plugin:card\n{"cards":[]}\n```'

  it('从 MCP content 包装 JSON 中提取 pluginId 与载荷', () => {
    const wrapped = JSON.stringify([{ type: 'text', text: `结果\n\n${fence}` }])
    expect(extractCardPayload(wrapped)).toEqual({
      pluginId: 'demo-plugin',
      payload: '{"cards":[]}',
    })
  })

  it('纯文本围栏块；旧 bilibili-card 语言不再匹配（无兼容垫片）', () => {
    expect(extractCardPayload(`前文\n${fence}\n后文`)).toEqual({
      pluginId: 'demo-plugin',
      payload: '{"cards":[]}',
    })
    expect(extractCardPayload('```bilibili-card\n{}\n```')).toBeNull()
    expect(extractCardPayload('普通文本')).toBeNull()
    expect(extractCardPayload('')).toBeNull()
  })

  it('载荷保持原文（宿主不解释 JSON 内容）', () => {
    const raw = 'not json at all'
    expect(extractCardPayload(`\`\`\`demo-plugin:card\n${raw}\n\`\`\``)?.payload).toBe(raw)
  })
})

describe('PluginCardHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('拉取入口 → iframe srcdoc + sandbox=allow-scripts → rendered 设置高度', async () => {
    fetchPluginFrontendMock.mockResolvedValue(RENDERER_HTML)
    const { container, unmount } = await renderAsync(
      <PluginCardHost pluginId="demo-plugin" payload='{"cards":[]}' />,
    )

    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe?.getAttribute('srcdoc')).toBe(RENDERER_HTML)

    // 首次 rendered(height=320)
    dispatchFromIframe(container, { type: 'rendered', height: 320 })
    expect((container.querySelector('iframe') as HTMLIFrameElement).style.height).toBe('320px')

    // 小于阈值的第二次上报不更新；超过阈值更新
    dispatchFromIframe(container, { type: 'rendered', height: 324 })
    expect((container.querySelector('iframe') as HTMLIFrameElement).style.height).toBe('320px')
    dispatchFromIframe(container, { type: 'rendered', height: 500 })
    expect((container.querySelector('iframe') as HTMLIFrameElement).style.height).toBe('500px')
    unmount()
  })

  it('渲染器报 error → 兜底卡片（含原始数据折叠）', async () => {
    fetchPluginFrontendMock.mockResolvedValue(RENDERER_HTML)
    const { container, unmount } = await renderAsync(
      <PluginCardHost pluginId="demo-plugin" payload='{"raw":1}' />,
    )
    dispatchFromIframe(container, { type: 'error', message: 'boom' })
    expect(container.querySelector('[data-testid="plugin-card-fallback"]')).not.toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.textContent).toContain('demo-plugin')
    unmount()
  })

  it('10s 未收到 rendered → 超时兜底', async () => {
    fetchPluginFrontendMock.mockResolvedValue(RENDERER_HTML)
    const { container, unmount } = await renderAsync(
      <PluginCardHost pluginId="demo-plugin" payload='{}' />,
    )
    await act(async () => {
      vi.advanceTimersByTime(10_500)
    })
    expect(container.querySelector('[data-testid="plugin-card-fallback"]')).not.toBeNull()
    unmount()
  })

  it('入口拉取失败（未启用/未声明）→ 兜底卡片', async () => {
    fetchPluginFrontendMock.mockRejectedValue(new Error('409'))
    const { container, unmount } = await renderAsync(
      <PluginCardHost pluginId="ghost" payload='{}' />,
    )
    expect(container.querySelector('[data-testid="plugin-card-fallback"]')).not.toBeNull()
    unmount()
  })

  it('open 消息仅放行 https 链接（http 与任意协议拒绝）', async () => {
    fetchPluginFrontendMock.mockResolvedValue(RENDERER_HTML)
    const openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)
    const { container, unmount } = await renderAsync(
      <PluginCardHost pluginId="demo-plugin" payload='{}' />,
    )
    dispatchFromIframe(container, { type: 'open', url: 'javascript:alert(1)' })
    dispatchFromIframe(container, { type: 'open', url: 'http://insecure.example' })
    expect(openSpy).not.toHaveBeenCalled()

    dispatchFromIframe(container, { type: 'open', url: 'https://example.com/video' })
    expect(openSpy).toHaveBeenCalledWith('https://example.com/video', '_blank', 'noopener,noreferrer')
    vi.unstubAllGlobals()
    unmount()
  })
})

// request id 旁路说明：currentRequestId 保留为协议占位（无断言使用）。
void currentRequestId
