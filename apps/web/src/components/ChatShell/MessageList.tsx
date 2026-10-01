// MessageList - 消息列表组件
// 使用虚拟滚动渲染消息列表

// Types
import type { Message } from '@my-copilot/shared'
import { MessageRole, MessageStatus } from '@my-copilot/shared'
import type { Virtualizer } from '@tanstack/react-virtual'
// Components
import MessageCard from '../common/MessageCard'
import ThinkingIndicator from '../common/ThinkingIndicator'
// Assets
import aiAvatar from '../../assets/img/avatar-ai.svg'

const DEFAULT_USER_AVATAR = 'https://avatars.githubusercontent.com/u/123456789?v=4'

interface MessageListProps {
  /** 就绪门控：false 时内容透明（仍参与布局与测量），稳定后淡入 */
  revealed: boolean
  messages: Message[]
  virtualizer: Virtualizer<HTMLDivElement, Element>
  containerRef: React.RefObject<HTMLDivElement | null>
  onRegenerate: (message: Message) => void
}

/**
 * 消息列表组件
 * 使用虚拟滚动渲染消息列表
 *
 * 渲染模式（TanStack Virtual 动态高度标准形态）：
 * - 滚动容器内只有一个 height=totalSize 的定位 wrapper，撑出精确的
 *   可滚动高度——不依赖"绝对定位元素扩展滚动区域"的隐式行为，也不再用
 *   双 spacer 拼高度（旧实现的 spacer 读取被 reverse() 原地反转过的数组，
 *   底部 spacer 取到的是顶部条目的 end，导致 scrollHeight 随滚动/流式
 *   持续振荡，滑块位置反复跳动）。
 * - 条目 absolute + translateY(item.start) 定位，挂载即 measureElement 实测。
 * - getVirtualItems() 返回的是库内 memoized 数组，严禁原地变异（如
 *   Array.prototype.reverse），否则跨渲染缓存数组被翻转、渲染顺序错乱。
 */
export default function MessageList({
  revealed,
  messages,
  virtualizer,
  containerRef,
  onRegenerate,
}: MessageListProps) {
  const assistantAvatarUrl = aiAvatar
  const virtualItems = virtualizer.getVirtualItems()

  // 判断用户消息是否有后续AI回复
  const hasNextAssistantMessage = (messageIndex: number): boolean => {
    if (messageIndex >= 0 && messageIndex < messages.length - 1) {
      const nextMessage = messages[messageIndex + 1]
      return nextMessage.role === MessageRole.ASSISTANT
    }
    return false
  }

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col w-full overflow-y-auto flex-1 px-4 pt-6"
    >
      {/* 唯一的可滚动高度来源：totalSize wrapper */}
      <div
        className={`shrink-0 transition-opacity duration-200 ${revealed ? 'opacity-100' : 'opacity-0'}`}
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualItem) => {
          const message = messages[virtualItem.index]
          const isUserMessage = message.role === MessageRole.USER
          const isAssistantMessage = message.role === MessageRole.ASSISTANT
          const isFailed = message.status === MessageStatus.FAILED

          // 用户消息：如果有后续AI回复，显示重新生成按钮
          const showRegenerate = isUserMessage && hasNextAssistantMessage(virtualItem.index)

          // 助手消息：如果失败，显示重试按钮
          const showRetry = isAssistantMessage && isFailed

          // 最新一条消息：挂 agent 实时状态指示（思考中 / 工具调用进度）
          const isLastMessage = virtualItem.index === messages.length - 1

          return (
            <div
              key={message.id}
              data-index={virtualItem.index}
              ref={(el) => {
                // 将元素传递给虚拟滚动器进行自动测量
                virtualizer.measureElement(el)
              }}
              className="absolute top-0 left-0 w-full"
              style={{
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {/* 与输入框同宽的居中内容列 */}
              <div className="max-w-3xl mx-auto px-4">
                <MessageCard
                  message={message}
                  userAvatarUrl={DEFAULT_USER_AVATAR}
                  assistantAvatarUrl={assistantAvatarUrl}
                  showRegenerate={showRegenerate}
                  onRegenerate={showRegenerate ? () => onRegenerate(message) : undefined}
                  onRetry={showRetry ? () => onRegenerate(message) : undefined}
                />
                {isLastMessage && (
                  <ThinkingIndicator alignRight={isUserMessage} />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
