// useMessageVirtualizer - 消息虚拟滚动 Hook
import { useVirtualizer } from '@tanstack/react-virtual'
import type { VirtualItem, Virtualizer } from '@tanstack/react-virtual'
import type { RefObject } from 'react'
import type { Message } from '@my-copilot/shared'

interface UseMessageVirtualizerParams {
  messages: Message[]
  containerRef: RefObject<HTMLDivElement | null>
}

/**
 * 滚动补偿判定：条目尺寸变化时是否需要调整 scrollTop 保持视口内容稳定。
 *
 * TanStack Virtual 默认条件是 `item.start < scrollOffset`——只看条目顶部。
 * 这对流式增长的消息是误判：消息横跨视口顶部时（start < scrollTop < end），
 * 它向下生长并不推移视口内内容，但默认条件仍触发补偿，scrollTop 被程序性
 * 累加，用户上滑阅读时会被持续下推（滑块跟着跳动）。
 *
 * 正确语义：只有条目【完全位于视口上方】（end <= scrollTop），其尺寸变化
 * 才会推移视口内容，才需要补偿。
 */
/**
 * 基于内容结构的初始估高（仅影响从未渲染过的消息；实测后由 itemSizeCache 接管）。
 *
 * 旧的 len/3 纯字符估算对含表格/代码块/图片的消息偏差可达一个数量级，
 * 首次进入长会话时会引发大幅度的估算→实测修正（视口内容跳动）。
 * 这里按块级结构分行估算，把初始误差收敛到可接受范围。
 *
 * 尺寸基准（与 MessageCard 渲染对齐的经验值）：
 * - 列内容宽约 704px（max-w-3xl 减去 padding 与头像），text-sm 中文约 45 字/行
 * - 正文行高 24px（leading-relaxed），代码行 20px，表格行约 40px
 * - 固定开销：发送者行 + 卡片 padding + 操作按钮 ≈ 110px
 */
export function estimateMessageHeight(message: Message): number {
  const content = message.content ?? ''
  const CHARS_PER_LINE = 45
  const LINE_HEIGHT = 24
  const CODE_LINE_HEIGHT = 20
  const FIXED_OVERHEAD = 110

  let height = FIXED_OVERHEAD
  let inCodeBlock = false
  for (const line of content.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      height += LINE_HEIGHT
      continue
    }
    if (inCodeBlock) {
      height += CODE_LINE_HEIGHT
      continue
    }
    if (line.trimStart().startsWith('|')) {
      // 表格行
      height += 40
      continue
    }
    height += Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)) * LINE_HEIGHT
  }
  // 附件缩略图（图片 max-h-60）
  height += (message.attachments?.length ?? 0) * 240
  return height
}
export function shouldAdjustScrollOnResize(
  item: Pick<VirtualItem, 'start' | 'end'>,
  scrollOffset: number | null,
): boolean {
  if (scrollOffset === null) return false
  return item.end <= scrollOffset
}

/**
 * 消息虚拟滚动 Hook
 * 用于优化大量消息的渲染性能
 */
export function useMessageVirtualizer({
  messages,
  containerRef,
}: UseMessageVirtualizerParams): Virtualizer<HTMLDivElement, Element> {
  // TanStack Virtual 返回含函数的对象，无法被 React Compiler 安全记忆化；
  // 编译器跳过本 hook 的自动 memo（库本身的已知限制），故豁免该提示。
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer<HTMLDivElement, Element>({
    count: messages.length,
    getScrollElement: () => containerRef.current,
    // 稳定 key：itemSizeCache 以 key 缓存实测高度。默认 key=index 时，
    // 尺寸缓存与消息实体脱钩（跨会话/重排后错位），导致大量无谓的
    // 估算→实测修正与滚动补偿。用消息 id 让重访消息直接命中缓存。
    getItemKey: (index: number) => messages[index]?.id ?? index,
    estimateSize: (index: number) => {
      // 仅影响从未见过的消息的初始估高，已渲染过的消息由 itemSizeCache 提供真实高度
      const message = messages[index]
      if (!message) return 150
      return estimateMessageHeight(message)
    },
    // 视野外预加载的消息数。
    // 历史值 35 是旧双 spacer 渲染模式下"滚不到底部"的补丁；
    // 改为标准 totalSize wrapper 后不再依赖大 overscan 维持可达性，
    // 收窄到 15 兼顾快速滚动的预渲染与挂载成本。
    overscan: 15,
    // measureElement 会自动测量实际渲染后的高度并缓存
    measureElement: (element: Element) => {
      if (!element) return 150
      return (element as HTMLElement).getBoundingClientRect().height
    },
  })

  // 自定义补偿判定（见 shouldAdjustScrollOnResize 的注释）。
  // TanStack Virtual 将其设计为 Virtualizer 实例属性而非 option
  // （setOptions 不会拷贝它），因此拿到实例后直接注入；回调为纯函数，
  // 每次渲染重复赋值幂等。
  rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (
    item: VirtualItem,
    _delta: number,
    instance: Virtualizer<HTMLDivElement, Element>,
  ) => shouldAdjustScrollOnResize(item, instance.scrollOffset)

  return rowVirtualizer
}
