// useEntryReveal - 进入会话的就绪门控 Hook
//
// 首次进入长会话时，虚拟列表对条目只有估算高度；挂载后可见条目逐批实测、
// 修正 totalSize，若直接展示，用户会看到底部内容被反复"推"出新的一块。
// 本 Hook 在布局稳定前隐藏消息列（opacity-0，仍参与布局与测量）并钉住底部，
// 稳定后一次性淡入。
//
// 重访会话（itemSizeCache 命中末条消息）时高度已知，不做门控：
// 直接瞬时定位到底部，零等待。

import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'

interface UseEntryRevealParams {
  containerRef: RefObject<HTMLDivElement | null>
  sessionId: string | undefined
  /** 有消息时门控才有意义（空会话走 EmptyChatView） */
  hasMessages: boolean
  /** 末条消息 id：用于探测尺寸缓存是否命中 */
  lastMessageId: string | undefined
  virtualizer: Virtualizer<HTMLDivElement, Element> | null
}

/** totalSize 连续无变化达到该时长即认为布局稳定 */
const STABLE_MS = 200
/** 门控超时兜底，避免极端情况（如图片持续加载）下迟迟不揭示 */
const TIMEOUT_MS = 1500

export function useEntryReveal({
  containerRef,
  sessionId,
  hasMessages,
  lastMessageId,
  virtualizer,
}: UseEntryRevealParams): { revealed: boolean; showLoading: boolean } {
  // 尺寸缓存是否命中末条消息（重访会话高度已知，免门控）。
  // 渲染期与 effect 各自实时计算，避免经由 ref 传递（react-hooks/refs 规则）。
  const hitCache = useCallback(() => {
    const cache = (virtualizer as { itemSizeCache?: Map<unknown, number> } | null)?.itemSizeCache
    return !!(cache && lastMessageId && cache.has(lastMessageId))
  }, [virtualizer, lastMessageId])

  // 初始值就要考虑门控：StrictMode 重挂载 / 路由重挂载时，组件可能带着
  // 已就绪的消息数据首次渲染，等不到 key 变化就已经展示了
  const [revealed, setRevealed] = useState(() => !hasMessages || hitCache())
  // 门控超过 300ms 才展示 Loading，避免短门控的闪烁
  const [showLoading, setShowLoading] = useState(false)

  // 会话/加载态切换的 key：变化时在渲染期同步决定是否门控，避免先画出一帧再隐藏
  const key = `${sessionId ?? ''}:${hasMessages}`
  const [prevKey, setPrevKey] = useState(key)
  if (key !== prevKey) {
    setPrevKey(key)
    setRevealed(!hasMessages || hitCache())
    setShowLoading(false)
  }

  useEffect(() => {
    if (!hasMessages || !sessionId) return
    const el = containerRef.current
    if (!el) return

    const hit = hitCache()
    // 无论是否命中缓存都跑钉底收敛循环：
    // - 未命中（首访）：内容隐藏，循环吸收估算→实测修正，稳定后揭示
    // - 命中（重访）：高度准确、内容立即可见，钉底循环负责瞬时定位到底部
    //   （wrapper 有 shrink-0，DOM 高度恒等于 totalSize，不存在滞后问题）
    let raf = 0
    let disposed = false
    const start = performance.now()
    let lastSize = -1
    let lastChange = performance.now()
    const loadingTimer = hit ? 0 : window.setTimeout(() => setShowLoading(true), 300)

    const tick = () => {
      if (disposed) return
      // 钉底
      el.scrollTop = el.scrollHeight
      const vSize = virtualizer?.getTotalSize() ?? 0
      if (vSize !== lastSize) {
        lastSize = vSize
        lastChange = performance.now()
      }
      const stable = performance.now() - lastChange >= STABLE_MS
      const overtime = performance.now() - start >= TIMEOUT_MS
      if (stable || overtime) {
        clearTimeout(loadingTimer)
        setShowLoading(false)
        setRevealed(true)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      clearTimeout(loadingTimer)
    }
  }, [key, hasMessages, sessionId, containerRef, virtualizer, hitCache])
  return { revealed, showLoading }
}
