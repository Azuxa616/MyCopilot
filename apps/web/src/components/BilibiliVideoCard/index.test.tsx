// BilibiliVideoCard 测试：卡片渲染要素 + JSON 解析边界。

import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'
import {
  BilibiliVideoCard,
  BilibiliCardBlock,
  type BilibiliCardData,
} from './index'
import { parseBilibiliCards, extractBilibiliCardPayload } from './parse'

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

const card: BilibiliCardData = {
  bvid: 'BV1Rm421N7Jy',
  title: 'Go语言教程_Golang入门实战',
  cover: 'https://i2.hdslb.com/bfs/archive/1539eda0.jpg',
  author: 'IT营大地',
  play: 431000,
  danmaku: 5720,
  duration: '37:02:32',
  pubdate: '2024-05-01',
  url: 'https://www.bilibili.com/video/BV1Rm421N7Jy',
}

describe('BilibiliVideoCard', () => {
  it('渲染封面/时长/标题/元信息，整卡外链且封面 no-referrer', async () => {
    const { container, unmount } = await renderAsync(<BilibiliVideoCard card={card} />)
    const link = container.querySelector('a[data-testid="bilibili-video-card"]')
    expect(link?.getAttribute('href')).toBe(card.url)
    expect(link?.getAttribute('target')).toBe('_blank')

    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe(card.cover)
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer')

    // 时长角标 + 标题 + 播放量短格式（43.1万）
    expect(container.textContent).toContain('37:02:32')
    expect(container.textContent).toContain('Go语言教程_Golang入门实战')
    expect(container.textContent).toContain('43.1万')
    unmount()
  })
})

describe('parseBilibiliCards', () => {
  it('接受 {cards:[…]} 对象与裸数组', () => {
    expect(parseBilibiliCards(JSON.stringify({ cards: [card] }))).toHaveLength(1)
    expect(parseBilibiliCards(JSON.stringify([card]))).toHaveLength(1)
  })

  it('坏 JSON / 缺字段 / 空数组返回 null', () => {
    expect(parseBilibiliCards('{oops')).toBeNull()
    expect(parseBilibiliCards('{"cards":[{ "bvid": "x" }]}')).toBeNull()
    expect(parseBilibiliCards('{"cards":[]}')).toBeNull()
    expect(parseBilibiliCards('42')).toBeNull()
  })

  it('超过上限截断到 12 张', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...card, bvid: `BV${i}` }))
    expect(parseBilibiliCards(JSON.stringify({ cards: many }))).toHaveLength(12)
  })
})

describe('extractBilibiliCardPayload', () => {
  const fence = '```bilibili-card\n{"cards":[]}\n```'

  it('从 MCP content 包装 JSON 中提取', () => {
    const wrapped = JSON.stringify([
      { type: 'text', text: `搜索结果…\n\n${fence}` },
    ])
    expect(extractBilibiliCardPayload(wrapped)).toBe('{"cards":[]}')
  })

  it('从纯文本中提取；无围栏块返回 null', () => {
    expect(extractBilibiliCardPayload(`前置文字\n${fence}\n后置`)).toBe('{"cards":[]}')
    expect(extractBilibiliCardPayload('普通结果，没有块')).toBeNull()
    expect(extractBilibiliCardPayload('')).toBeNull()
  })
})

describe('BilibiliCardBlock', () => {
  it('合法载荷渲染卡片网格', async () => {
    const { container, unmount } = await renderAsync(
      <BilibiliCardBlock payload={JSON.stringify({ cards: [card, { ...card, bvid: 'BV2' }] })} />,
    )
    expect(container.querySelectorAll('[data-testid="bilibili-video-card"]').length).toBe(2)
    expect(container.querySelector('[data-testid="bilibili-card-grid"]')).not.toBeNull()
    unmount()
  })

  it('非法载荷回退为普通代码块', async () => {
    const { container, unmount } = await renderAsync(<BilibiliCardBlock payload="{oops" />)
    expect(container.querySelector('[data-testid="bilibili-card-fallback"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="bilibili-card-grid"]')).toBeNull()
    unmount()
  })
})
