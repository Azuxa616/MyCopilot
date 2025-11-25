// MessageList - 消息列表组件
import { useUserStore } from '../../store/userStore'
import MessageCard from '../common/MessageCard'
import type { Message } from '../../types/chat'
import { MessageRole, MessageStatus } from '../../types/chat'
import type { Virtualizer } from '@tanstack/react-virtual'

interface MessageListProps {
  messages: Message[]
  virtualizer: Virtualizer<HTMLDivElement, Element>
  containerRef: React.RefObject<HTMLDivElement | null>
  onRegenerate: (message: Message) => void
}

/**
 * 消息列表组件
 * 使用虚拟滚动渲染消息列表
 */
export default function MessageList({
  messages,
  virtualizer,
  containerRef,
  onRegenerate,
}: MessageListProps) {
  const { user } = useUserStore()
  const assistantAvatarUrl = './src/assets/img/avatar-ai.svg'
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
      className="relative flex flex-col w-full overflow-y-auto flex-1 px-20 pt-10"
    >
      {/* 虚拟滚动占位符 - 上方空白 */}
      {virtualItems.length > 0 && (
        <div
          style={{
            height: `${virtualItems[0]?.start ?? 0}px`,
          }}
        />
      )}

      {/* 渲染可见的消息 */}
      {virtualItems.reverse().map((virtualItem) => {
        const message = messages[virtualItem.index]
        const isUserMessage = message.role === MessageRole.USER
        const isAssistantMessage = message.role === MessageRole.ASSISTANT
        const isFailed = message.status === MessageStatus.FAILED

        // 用户消息：如果有后续AI回复，显示重新生成按钮
        const showRegenerate = isUserMessage && hasNextAssistantMessage(virtualItem.index)

        // 助手消息：如果失败，显示重试按钮
        const showRetry = isAssistantMessage && isFailed

        return (
          <div
            key={message.id}
            data-index={virtualItem.index}
            ref={(el) => {
              // 将元素传递给虚拟滚动器进行自动测量
              virtualizer.measureElement(el)
            }}
            className="absolute top-0 left-0 w-full mb-10 px-12"
            style={{
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <MessageCard
              message={message}
              userAvatarUrl={user?.avatarUrl}
              assistantAvatarUrl={assistantAvatarUrl}
              showRegenerate={showRegenerate}
              onRegenerate={showRegenerate ? () => onRegenerate(message) : undefined}
              onRetry={showRetry ? () => onRegenerate(message) : undefined}
            />
          </div>
        )
      })}

      {/* 虚拟滚动占位符 - 下方空白 */}
      {virtualItems.length > 0 && (
        <div
          style={{
            height: `${virtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1]?.end ?? 0)}px`,
          }}
        />
      )}
    </div>
  )
}

