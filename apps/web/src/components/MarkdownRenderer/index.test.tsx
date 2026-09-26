// MarkdownRenderer 测试：img 元素必须带 referrerPolicy="no-referrer"
// （外链图床如 B 站 hdslb.com 有 Referer 防盗链，带本站 Referer 会 403 图裂）。

import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'
import MarkdownRenderer from './index'

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

describe('MarkdownRenderer bilibili-card 围栏块', () => {
  const cardPayload = JSON.stringify({
    cards: [
      {
        bvid: 'BV1Rm421N7Jy',
        title: 'Go语言教程',
        cover: 'https://i2.hdslb.com/bfs/archive/1539eda0.jpg',
        author: 'IT营大地',
        play: 431000,
        danmaku: 5720,
        duration: '37:02:32',
        pubdate: '2024-05-01',
        url: 'https://www.bilibili.com/video/BV1Rm421N7Jy',
      },
    ],
  })

  it('合法围栏块渲染为卡片网格，且不包代码框', async () => {
    const { container, unmount } = await renderAsync(
      <MarkdownRenderer content={`\`\`\`bilibili-card\n${cardPayload}\n\`\`\``} />,
    )
    const grid = container.querySelector('[data-testid="bilibili-card-grid"]')
    expect(grid).not.toBeNull()
    expect(container.querySelector('[data-testid="bilibili-video-card"]')).not.toBeNull()
    // 不应出现代码框（复制按钮 / data-language 头）
    expect(container.querySelector('[data-language]')).toBeNull()
    expect(container.querySelector('button[aria-label="复制代码"]')).toBeNull()
    unmount()
  })

  it('非法 JSON 回退为代码块展示', async () => {
    const { container, unmount } = await renderAsync(
      <MarkdownRenderer content={'```bilibili-card\n{oops\n```'} />,
    )
    expect(container.querySelector('[data-testid="bilibili-card-fallback"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="bilibili-card-grid"]')).toBeNull()
    unmount()
  })
})
