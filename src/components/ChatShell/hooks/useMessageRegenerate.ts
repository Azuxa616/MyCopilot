// useMessageRegenerate - 消息重新生成 Hook
import { useChatStore } from '../../../store/chatStore'
import type { Message } from '../../../types/chat'
import { MessageRole } from '../../../types/chat'

/**
 * 消息重新生成 Hook
 * 处理用户消息和助手消息的重新生成逻辑
 */
export function useMessageRegenerate() {
  const selectedChatId = useChatStore((state) => state.selectedChatId)
  const currentChat = useChatStore((state) => state.currentChat)
  const deleteMessage = useChatStore((state) => state.deleteMessage)
  const sendMessage = useChatStore((state) => state.sendMessage)

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

  return { handleRegenerate }
}

