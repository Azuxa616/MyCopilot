// ChatShell - 聊天界面
// 包含消息发送框，以及对话内容展示区

import { useEffect, useRef } from 'react'
// Components
import Sender from '../Sender'
import EmptyChatView from './EmptyChatView'
import LoadingChatView from './LoadingChatView'
import MessageList from './MessageList'
// Hooks
import { useMessageVirtualizer } from './hooks/useMessageVirtualizer'
import { useAutoScroll } from './hooks/useAutoScroll'
import { useMessageRegenerate } from './hooks/useMessageRegenerate'
// Store
import { useChatStore } from '../../store/chatStore'

export default function ChatShell() {
  const selectedChatId = useChatStore((state) => state.selectedChatId)
  const currentChat = useChatStore((state) => state.currentChat)
  const isLoadingMessages = useChatStore((state) => state.isLoadingMessages)
  const loadChatMessages = useChatStore((state) => state.loadChatMessages)

  // 聊天内容滚动容器
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)

  // 虚拟滚动器
  const virtualizer = useMessageVirtualizer({
    messages: currentChat?.messages ?? [],
    containerRef: messagesContainerRef,
  })

  // 自动滚动逻辑
  useAutoScroll({
    messagesLength: currentChat?.messages.length ?? 0,
    chatId: currentChat?.id,
    virtualizer,
    containerRef: messagesContainerRef,
  })

  // 消息重新生成逻辑
  const { handleRegenerate } = useMessageRegenerate()

  // 当选中聊天变化时，按需加载消息
  useEffect(() => {
    if (selectedChatId && !currentChat) {
      loadChatMessages(selectedChatId)
    }
  }, [selectedChatId, currentChat, loadChatMessages])

  // 新对话状态
  if (!selectedChatId || !currentChat || !currentChat.messages.length) {
    return <EmptyChatView />
  }

  // 加载中状态
  if (isLoadingMessages || !currentChat) {
    return <LoadingChatView />
  }

  // 显示聊天消息
  return (
    <div className="flex flex-col h-full justify-between items-center gap-6 w-full pb-6">
      <MessageList
        messages={currentChat.messages}
        virtualizer={virtualizer}
        containerRef={messagesContainerRef}
        onRegenerate={handleRegenerate}
      />
      <Sender />
    </div>
  )
}
