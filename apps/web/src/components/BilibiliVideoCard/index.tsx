// BilibiliVideoCard - B 站视频卡片与卡片网格。
//
// 数据来源：bilibili-search 插件的 bilibili_search_videos 工具输出
// ```bilibili-card {"cards":[…]}``` 围栏块（agent 原样抄进回复），由
// MarkdownRenderer 的 code 组件拦截后交给这里的网格渲染。
//
// 卡片：16:9 封面（右下时长角标、hover 播放遮罩）+ 两行截断标题 +
// UP 主/播放/弹幕元信息行；整卡为外链。封面必须 referrerPolicy="no-referrer"
// （hdslb.com 图床 Referer 防盗链）。

import type { ReactNode } from 'react'
import { Eye, MessageSquare, Play } from 'lucide-react'
import { parseBilibiliCards, type BilibiliCardData } from './parse'

export type { BilibiliCardData } from './parse'

/** 播放/弹幕数的中文短格式。 */
function formatCount(n: number): string {
  return n >= 10_000 ? `${(n / 10_000).toFixed(1)}万` : String(n)
}

/** 单张视频卡片：整卡可点，跳转 B 站。 */
export function BilibiliVideoCard({ card }: { card: BilibiliCardData }) {
  return (
    <a
      href={card.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col overflow-hidden rounded-xl border border-border-base bg-bg-secondary transition-all hover:border-primary-400 hover:shadow-md"
      title={card.title}
      data-testid="bilibili-video-card"
    >
      {/* 封面：16:9 + 时长角标 + hover 播放遮罩 */}
      <div className="relative aspect-video w-full shrink-0 bg-bg-tertiary">
        <img
          src={card.cover}
          alt={card.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover"
        />
        {card.duration && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] leading-none text-white">
            {card.duration}
          </span>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
          <span className="rounded-full bg-black/60 p-2 opacity-0 transition-opacity group-hover:opacity-100">
            <Play className="h-4 w-4 text-white" aria-hidden />
          </span>
        </div>
      </div>

      {/* 标题 + 元信息 */}
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <span className="line-clamp-2 text-[13px] font-medium leading-snug text-text-primary">
          {card.title}
        </span>
        <div className="flex items-center gap-2 overflow-hidden text-[11px] text-text-tertiary">
          <span className="max-w-[45%] truncate" title={`UP 主：${card.author}`}>
            {card.author}
          </span>
          <span className="flex shrink-0 items-center gap-0.5" title={`播放 ${card.play}`}>
            <Eye className="h-3 w-3" aria-hidden />
            {formatCount(card.play)}
          </span>
          <span className="flex shrink-0 items-center gap-0.5" title={`弹幕 ${card.danmaku}`}>
            <MessageSquare className="h-3 w-3" aria-hidden />
            {formatCount(card.danmaku)}
          </span>
        </div>
      </div>
    </a>
  )
}

/** 围栏块渲染入口：解析失败时回退为原始代码块展示。 */
export function BilibiliCardBlock({ payload }: { payload: string }): ReactNode {
  const cards = parseBilibiliCards(payload)
  if (cards === null) {
    return (
      <code className="language-bilibili-card" data-testid="bilibili-card-fallback">
        {payload}
      </code>
    )
  }
  return (
    <div
      className="my-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
      data-testid="bilibili-card-grid"
      aria-label="B 站视频卡片"
    >
      {cards.map((card) => (
        <BilibiliVideoCard key={card.bvid} card={card} />
      ))}
    </div>
  )
}
