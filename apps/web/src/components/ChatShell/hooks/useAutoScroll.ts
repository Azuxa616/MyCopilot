// useAutoScroll - 自动滚动 Hook
import { useEffect, useRef } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'

interface UseAutoScrollParams {
  messagesLength: number
  sessionId: string | undefined
  virtualizer: Virtualizer<HTMLDivElement, Element> | null
  containerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Auto-scroll hook
 * Handles smart scrolling logic for message list:
 * - Scroll to bottom on initial load
 * - Auto-scroll only when user is near bottom on new messages
 */
export function useAutoScroll({
  messagesLength,
  sessionId,
  virtualizer,
  containerRef,
}: UseAutoScrollParams) {
  // Scroll state tracking
  const isInitialLoadRef = useRef(true)
  const isNearBottomRef = useRef(true)
  const shouldAutoScrollRef = useRef(true)
  const lastSessionIdRef = useRef<string | null>(null)

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

  // Auto-scroll when messages change in current session
  useEffect(() => {
    if (!messagesLength || !virtualizer || !sessionId) return

    const isNewSession = lastSessionIdRef.current !== sessionId
    lastSessionIdRef.current = sessionId

    // First load of session: scroll to bottom immediately
    if (isNewSession || isInitialLoadRef.current) {
      isInitialLoadRef.current = false
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(messagesLength - 1, {
          align: 'end',
          behavior: 'auto',
        })
        shouldAutoScrollRef.current = true
        isNearBottomRef.current = true
      })
      return
    }

    // New messages: only auto-scroll if user is near bottom
    if (shouldAutoScrollRef.current) {
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(messagesLength - 1, {
          align: 'end',
          behavior: 'smooth',
        })
      })
    }
  }, [sessionId, messagesLength, virtualizer])
}

