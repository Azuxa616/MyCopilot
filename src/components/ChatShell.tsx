// ChatShell - 聊天界面
// 包含消息发送框，以及对话内容展示区

import { useEffect, useRef } from 'react'
// Components
import Sender from './Sender'
import MessageCard from './common/MessageCard'
// Utils
import { getTimePeriod } from '../utils/time'
// Store
import { useUserStore } from '../store/userStore'
import { useChatStore } from '../store/chatStore'
// Types
import { MessageRole, MessageStatus } from '../types/chat'
import type { Message } from '../types/chat'

export default function ChatShell() {
  const selectedChatId = useChatStore((state) => state.selectedChatId)
  const currentChat = useChatStore((state) => state.currentChat)
  const isLoadingMessages = useChatStore((state) => state.isLoadingMessages)
  const loadChatMessages = useChatStore((state) => state.loadChatMessages)
  const deleteMessage = useChatStore((state) => state.deleteMessage)
  const sendMessage = useChatStore((state) => state.sendMessage)
  const { user } = useUserStore()

  // 聊天内容滚动容器
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)

  // 当选中聊天变化时，按需加载消息
  useEffect(() => {
    if (selectedChatId && !currentChat) {
      loadChatMessages(selectedChatId)
    }
  }, [selectedChatId, currentChat, loadChatMessages])

  // 当前会话的消息变化时，自动滚动到底部
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    })
  }, [currentChat?.id, currentChat?.messages.length])

  const greetingPrefix =
    getTimePeriod(Date.now()) === '凌晨' ? '夜深了' : `${getTimePeriod(Date.now())}好`

  const assistantAvatarUrl =
    './src/assets/img/avatar-ai.svg'

  // 处理重新生成（支持用户消息和助手消息）
  const handleRegenerate = async (message: Message) => {
    if (!selectedChatId || !currentChat) return

    const messages = currentChat.messages
    const messageIndex = messages.findIndex((msg) => msg.id === message.id)

    if (message.role === MessageRole.USER) {
      // 用户消息：查找下一条消息，如果是AI消息则删除
      if (messageIndex >= 0 && messageIndex < messages.length - 1) {
        const nextMessage = messages[messageIndex + 1]
        if (nextMessage.role === MessageRole.ASSISTANT) {
          deleteMessage(selectedChatId, nextMessage.id)
        }
      }

      // 重新发送用户消息
      await sendMessage({
        chatId: selectedChatId,
        content: message.content,
        role: MessageRole.USER,
        attachments: message.attachments,
      })
    } else if (message.role === MessageRole.ASSISTANT) {
      // 助手消息：查找上一条用户消息，重新发送
      if (messageIndex > 0) {
        const prevMessage = messages[messageIndex - 1]
        if (prevMessage.role === MessageRole.USER) {
          // 删除当前失败的助手消息
          deleteMessage(selectedChatId, message.id)
          
          // 重新发送用户消息
          await sendMessage({
            chatId: selectedChatId,
            content: prevMessage.content,
            role: MessageRole.USER,
            attachments: prevMessage.attachments,
          })
        }
      }
    }
  }

  // 判断用户消息是否有后续AI回复
  const hasNextAssistantMessage = (messageIndex: number): boolean => {
    if (!currentChat) return false
    const messages = currentChat.messages
    if (messageIndex >= 0 && messageIndex < messages.length - 1) {
      const nextMessage = messages[messageIndex + 1]
      return nextMessage.role === MessageRole.ASSISTANT
    }
    return false
  }

  // 新对话状态
  if (!selectedChatId || !currentChat || !currentChat.messages.length) {
    return (
      <div className="flex flex-col h-full justify-center items-center gap-10 w-full max-w-4xl">
        <span className="text-3xl font-sans text-text-primary text-center">
          {greetingPrefix}，{user?.username ?? '用户'}，有什么可以帮你的吗？
        </span>
        <Sender />
      </div>
    )
  }

  // 加载中状态
  if (isLoadingMessages || !currentChat) {
    return (
      <div className="flex flex-col h-full justify-center items-center gap-10 w-full max-w-4xl">
        <span className="text-lg text-text-secondary">加载中...</span>
      </div>
    )
  }

  // 显示聊天消息
  return (
    <div className="flex flex-col h-full justify-between items-center gap-6 w-full  pb-6">
      <div
        ref={messagesContainerRef}
        className="flex flex-col gap-2 w-full overflow-y-auto flex-1 px-20 pt-10"
      >
        {currentChat.messages.map((message, index) => {
          const isUserMessage = message.role === MessageRole.USER
          const isAssistantMessage = message.role === MessageRole.ASSISTANT
          const isFailed = message.status === MessageStatus.FAILED
          
          // 用户消息：如果有后续AI回复，显示重新生成按钮
          const showRegenerate = isUserMessage && hasNextAssistantMessage(index)
          
          // 助手消息：如果失败，显示重试按钮
          const showRetry = isAssistantMessage && isFailed
          
          return (
            <MessageCard
              key={message.id}
              message={message}
              userAvatarUrl={user?.avatarUrl}
              assistantAvatarUrl={assistantAvatarUrl}
              showRegenerate={showRegenerate}
              onRegenerate={showRegenerate ? () => handleRegenerate(message) : undefined}
              onRetry={showRetry ? () => handleRegenerate(message) : undefined}
            />
          )
        })}
      </div>
      <Sender />
    </div>
  )
}
