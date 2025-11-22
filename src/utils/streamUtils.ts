import { createParser } from 'eventsource-parser'
import type { Message } from '../types/chat'
import { MessageStatus } from '../types/chat'

interface StreamAIResponseData {
  stream: ReadableStream<Uint8Array>
  close: () => void
}

interface StreamHandlerParams {
  chatId: string
  assistantMessageId: string
  streamAIResponse: StreamAIResponseData
  onContentUpdate: (chatId: string, messageId: string, content: string) => void
  onError: (chatId: string, messageId: string, error: string) => void
}

/**
 * 处理 SSE 流式响应
 * 解析流数据并实时更新消息内容
 */
export async function handleStreamResponse({
  chatId,
  assistantMessageId,
  streamAIResponse,
  onContentUpdate,
  onError,
}: StreamHandlerParams): Promise<void> {
  const { stream, close } = streamAIResponse
  const reader = stream.getReader()
  const decoder = new TextDecoder()

  let fullContent = ''
  let streamEnded = false
  let parserError: Error | null = null

  const parser = createParser((event) => {
    if (event.type !== 'event') {
      return
    }

    if (event.event === 'error') {
      parserError = new Error(event.data || '流式读取失败')
      streamEnded = true
      return
    }

    const dataPart = event.data ?? ''

    if (event.event === 'done' || dataPart.trim() === '[DONE]') {
      streamEnded = true
      return
    }

    if (dataPart === '') {
      fullContent += '\n'
    } else {
      fullContent += dataPart
    }

    onContentUpdate(chatId, assistantMessageId, fullContent)
  })

  // SSE 解析：逐字符提取并累积内容，实现打字机效果
  const readStream = async () => {
    try {
      while (!streamEnded) {
        const { value, done } = await reader.read()
        if (done) {
          const flushText = decoder.decode()
          if (flushText) {
            parser.feed(flushText)
          }
          break
        }

        if (value) {
          const chunkText = decoder.decode(value, { stream: true })
          parser.feed(chunkText)
        }

        if (parserError) {
          throw parserError
        }
      }

      if (parserError) {
        throw parserError
      }
    } catch (streamError) {
      console.error('读取流数据失败:', streamError)
      const errorMessage =
        streamError instanceof Error ? streamError.message : '流式读取失败'
      onError(chatId, assistantMessageId, errorMessage)
      throw streamError
    } finally {
      // 确保关闭流和 reader
      try {
        reader.releaseLock()
        close()
      } catch (closeError) {
        // 忽略关闭错误
        console.warn('关闭流时出错:', closeError)
      }
    }
  }

  // 开始读取流
  await readStream()
}

