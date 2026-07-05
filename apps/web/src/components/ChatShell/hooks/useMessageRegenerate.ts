// TODO: Phase 2 - remove or reimplement message regeneration
// useMessageRegenerate - Message regeneration hook
import { useSessionStore } from '../../../store/sessionStore'
import type { Message } from '@my-copilot/shared';

/**
 * Message regeneration hook
 * Handles regeneration of user messages and assistant messages
 */
export function useMessageRegenerate() {
  const selectedSessionId = useSessionStore((state) => state.selectedSessionId)
  const messagesCache = useSessionStore((state) => state.messagesCache)
  const deleteMessage = useSessionStore((state) => state.deleteMessage)
  const sendMessage = useSessionStore((state) => state.sendMessage)

  const handleRegenerate = async (message: Message) => {
    if (!selectedSessionId) return

    const messages = messagesCache[selectedSessionId] || []
    const messageIndex = messages.findIndex((msg) => msg.id === message.id)

    if (message.role === 'user') {
      // User message: find next message, if it's AI message then delete it
      if (messageIndex >= 0 && messageIndex < messages.length - 1) {
        const nextMessage = messages[messageIndex + 1]
        if (nextMessage.role === 'assistant') {
          deleteMessage(selectedSessionId, nextMessage.id)
        }
      }

      // Re-send user message
      await sendMessage({
        sessionId: selectedSessionId,
        content: message.content,
      })
    } else if (message.role === 'assistant') {
      // Assistant message: find previous user message and re-send
      if (messageIndex > 0) {
        const prevMessage = messages[messageIndex - 1]
        if (prevMessage.role === 'user') {
          // Delete current failed assistant message
          deleteMessage(selectedSessionId, message.id)

          // Re-send the user message
          await sendMessage({
            sessionId: selectedSessionId,
            content: prevMessage.content,
          })
        }
      }
    }
  }

  return { handleRegenerate }
}
