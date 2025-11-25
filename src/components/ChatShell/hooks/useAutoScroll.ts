// useAutoScroll - 自动滚动 Hook
import { useEffect, useRef } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'

interface UseAutoScrollParams {
  messagesLength: number
  chatId: string | undefined
  virtualizer: Virtualizer<HTMLDivElement, Element> | null
  containerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * 自动滚动 Hook
 * 处理消息列表的智能滚动逻辑：
 * - 首次加载时滚动到底部
 * - 新消息到达时，只有在用户接近底部时才自动滚动
 */
export function useAutoScroll({
  messagesLength,
  chatId,
  virtualizer,
  containerRef,
}: UseAutoScrollParams) {
  // 滚动状态跟踪
  const isInitialLoadRef = useRef(true)
  const isNearBottomRef = useRef(true)
  const shouldAutoScrollRef = useRef(true)
  const lastChatIdRef = useRef<string | null>(null)

  // 监听滚动事件，检测用户是否在底部附近
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100
      isNearBottomRef.current = isNearBottom
      shouldAutoScrollRef.current = isNearBottom
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [containerRef])

  // 当前会话的消息变化时，智能滚动到底部
  useEffect(() => {
    if (!messagesLength || !virtualizer || !chatId) return

    const isNewChat = lastChatIdRef.current !== chatId
    lastChatIdRef.current = chatId

    // 首次加载对话时，直接滚动到底部
    if (isNewChat || isInitialLoadRef.current) {
      isInitialLoadRef.current = false
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(messagesLength - 1, {
          align: 'end',
          behavior: 'auto', // 首次加载使用 auto，避免动画
        })
        shouldAutoScrollRef.current = true
        isNearBottomRef.current = true
      })
      return
    }

    // 新消息到达时，只有在用户接近底部时才滚动
    if (shouldAutoScrollRef.current) {
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(messagesLength - 1, {
          align: 'end',
          behavior: 'smooth',
        })
      })
    }
  }, [chatId, messagesLength, virtualizer])
}

