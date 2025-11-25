// useMessageVirtualizer - 消息虚拟滚动 Hook
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Virtualizer } from '@tanstack/react-virtual'
import type { RefObject } from 'react'
import type { Message } from '../../../types/chat'

interface UseMessageVirtualizerParams {
  messages: Message[]
  containerRef: RefObject<HTMLDivElement | null>
}

/**
 * 消息虚拟滚动 Hook
 * 用于优化大量消息的渲染性能
 */
export function useMessageVirtualizer({
  messages,
  containerRef,
}: UseMessageVirtualizerParams): Virtualizer<HTMLDivElement, Element> {
  const rowVirtualizer = useVirtualizer<HTMLDivElement, Element>({
    count: messages.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (index: number) => {
      // 简化估计，每3个字符约1px
      const message = messages[index]
      if (!message) return 150
      return 80 + Math.ceil((message.content?.length ?? 0) / 3)
    },
    // 视野外预加载的消息数
    // 注意：
    // 这个值越大，预加载的消息越多，但也会占用更多的性能
    // 这个值越小，预加载的消息越少，但浏览的体验会更差
    // 目前项目中，当overscan的值小于消息总数的1/2时，会出现新发消息后无法滚动到最底部的问题
    // 当存在长消息时，这个比值会更大，但在消息数较少的对话中不明显
    overscan: 35,
    // measureElement 会自动测量实际渲染后的高度并缓存
    measureElement: (element: Element) => {
      if (!element) return 150
      return (element as HTMLElement).getBoundingClientRect().height
    },
  })

  return rowVirtualizer
}

