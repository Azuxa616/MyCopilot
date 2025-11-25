// ChatShell - 聊天界面
// 包含消息发送框，以及对话内容展示区

import { useEffect, useRef, useState } from 'react'
// Components
import Sender from './Sender'
import MessageCard from './common/MessageCard'
// Utils
import { getTimePeriod } from '../utils/time'
import { countNewlines } from '../utils/content'
// Store
import { useUserStore } from '../store/userStore'
import { useChatStore } from '../store/chatStore'
// Types
import { MessageRole, MessageStatus } from '../types/chat'
import type { Message } from '../types/chat'
// Virtual Scroll
import {useVirtualizer} from '@tanstack/react-virtual';


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

  // 滚动状态跟踪
  const isInitialLoadRef = useRef(true)
  const isNearBottomRef = useRef(true)
  const shouldAutoScrollRef = useRef(true)
  const lastChatIdRef = useRef<string | null>(null)

  //虚拟化器
  const rowVirtualizer = useVirtualizer({
    count: currentChat?.messages.length ?? 0,
    getScrollElement: () => messagesContainerRef.current,
    estimateSize: (index: number) => {
      // 简化估计，每3个字符约1px
      const message = currentChat?.messages[index]
      if (!message) return 150
      return 80 + Math.ceil((message.content?.length ?? 0) / 3) 
    },
    //视野外预加载的消息数
    //注意：
    // 这个值越大，预加载的消息越多，但也会占用更多的性能
    // 这个值越小，预加载的消息越少，但浏览的体验会更差
    // 目前项目中，当overscan的值小于消息总数的1/2时，会出现新发消息后无法滚动到最底部的问题
    // 当寻存在长消息时，这个比值会更大，但在消息数较少的对话中不明显
    overscan: 35,
    // measureElement 会自动测量实际渲染后的高度并缓存
    measureElement: (element: Element) => {
      if (!element) return 150
      return (element as HTMLElement).getBoundingClientRect().height
    }
  })


  // 当选中聊天变化时，按需加载消息
  useEffect(() => {
    if (selectedChatId && !currentChat) {
      loadChatMessages(selectedChatId)
    }
  }, [selectedChatId, currentChat, loadChatMessages])

  // 监听滚动事件，检测用户是否在底部附近
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100
      isNearBottomRef.current = isNearBottom
      shouldAutoScrollRef.current = isNearBottom
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  // 当前会话的消息变化时，智能滚动到底部
  useEffect(() => {
    if (!currentChat?.messages.length || !rowVirtualizer) return

    const isNewChat = lastChatIdRef.current !== currentChat.id
    lastChatIdRef.current = currentChat.id

    // 首次加载对话时，直接滚动到底部
    if (isNewChat || isInitialLoadRef.current) {
      isInitialLoadRef.current = false
      requestAnimationFrame(() => {
        rowVirtualizer.scrollToIndex(currentChat.messages.length - 1, {
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
        rowVirtualizer.scrollToIndex(currentChat.messages.length - 1, {
          align: 'end',
          behavior: 'smooth',
        })
      })
    }
  }, [currentChat?.id, currentChat?.messages.length, rowVirtualizer])

  // 使用 useState 初始化问候语，避免在渲染期间调用 Date.now()
  const [greetingPrefix] = useState(() => {
    const now = Date.now()
    const period = getTimePeriod(now)
    return period === '凌晨' ? '夜深了' : `${period}好`
  })

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
  const virtualItems = rowVirtualizer.getVirtualItems()

  return (
    <div className="flex flex-col h-full justify-between items-center gap-6 w-full pb-6 ">
      <div
        ref={messagesContainerRef}
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
          console.log('加载virtualItem:', virtualItem)
          const message = currentChat.messages[virtualItem.index]
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
                rowVirtualizer.measureElement(el)
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
                onRegenerate={showRegenerate ? () => handleRegenerate(message) : undefined}
                onRetry={showRetry ? () => handleRegenerate(message) : undefined}
              />
            </div>
          )
        })}

        {/* 虚拟滚动占位符 - 下方空白 */}
        {virtualItems.length > 0 && (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1]?.end ?? 0)}px`,
            }}
          />
        )}
      </div>
      <Sender />
    </div>
  )
}
