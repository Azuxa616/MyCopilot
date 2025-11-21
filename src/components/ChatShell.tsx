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

export default function ChatShell() {
  const selectedChatId = useChatStore((state) => state.selectedChatId)
  const currentChat = useChatStore((state) => state.currentChat)
  const isLoadingMessages = useChatStore((state) => state.isLoadingMessages)
  const loadChatMessages = useChatStore((state) => state.loadChatMessages)
  const { user } = useUserStore()

  // 聊天内容滚动容器
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)

  // 当选中聊天变化时，按需加载消息
  useEffect(() => {
    if (selectedChatId && !currentChat) {
      loadChatMessages(selectedChatId)
    }
  }, [selectedChatId, currentChat, loadChatMessages])

  // 当当前会话的消息变化时，自动滚动到底部
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
    'https://api.dicebear.com/7.x/bottts-neutral/svg?seed=MyCopilot'

  // 新对话时，显示欢迎语和发送框
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
        className="flex flex-col gap-2 w-full overflow-y-auto flex-1 px-20"
      >
        {currentChat.messages.map((message) => (
          <MessageCard
            key={message.id}
            message={message}
            userAvatarUrl={user?.avatarUrl}
            assistantAvatarUrl={assistantAvatarUrl}
          />
        ))}
      </div>
      <Sender />
    </div>
  )
}
