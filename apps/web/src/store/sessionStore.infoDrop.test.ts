// sessionStore.infoDrop.test.ts — 聊天流信息丢弃修补（计划 todo 11 c/d/e/h）的回调语义测试。
// 复用 agentState 测试的 parseSSEStream 捕获模式：直接驱动 sendMessage 挂接的回调。

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', () => ({
  api: {
    sendMessage: vi.fn(),
    stopStream: vi.fn(),
  },
}))

vi.mock('../utils/streamUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/streamUtils')>()
  return { ...actual, parseSSEStream: vi.fn() }
})

import { api } from '../api'
import { parseSSEStream } from '../utils/streamUtils'
import type { SSEStreamParams } from '../utils/streamUtils'
import { useSessionStore } from './sessionStore'
import type { MessageWithToolError } from './sessionStore'
import type { Message } from '@my-copilot/shared'

describe('sessionStore 聊天流信息丢弃修补', () => {
  let captured: SSEStreamParams | undefined

  const getMessage = (id: string): MessageWithToolError | undefined =>
    useSessionStore.getState().messagesCache.s1?.find(m => m.id === id) as MessageWithToolError | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    captured = undefined
    vi.mocked(parseSSEStream).mockImplementation(async (params) => {
      captured = params
    })
    vi.mocked(api.sendMessage).mockResolvedValue({
      mode: 'stream',
      stream: new ReadableStream<Uint8Array>(),
    })
    vi.mocked(api.stopStream).mockResolvedValue(undefined)
    useSessionStore.setState({
      messagesCache: { s1: [] },
      selectedSessionId: 's1',
      isSending: false,
      abortController: null,
      activeJobId: null,
      agentState: 'idle',
      activeToolCalls: [],
    })
  })

  describe('onToolResult 写入 tool 消息（修补 c）', () => {
    it('appends a tool message carrying the result content and toolCallId', async () => {
      await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })
      captured!.onPlaceholder('m1')
      captured!.onToolResult!('m1', 'tc-1', '[{"type":"text","text":"5"}]', false)

      expect(getMessage('tool-tc-1')).toMatchObject({
        role: 'tool',
        content: '[{"type":"text","text":"5"}]',
        toolCallId: 'tc-1',
        status: 'sent',
      })
    })

    it('records toolIsError on the appended tool message when the result is an error', async () => {
      await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })
      captured!.onPlaceholder('m1')
      captured!.onToolResult!('m1', 'tc-ok', '"ok"', false)
      captured!.onToolResult!('m1', 'tc-bad', '"boom"', true)

      expect(getMessage('tool-tc-ok')?.toolIsError).toBe(false)
      expect(getMessage('tool-tc-bad')?.toolIsError).toBe(true)
    })

    it('does not duplicate the tool message for a repeated tool_result', async () => {
      await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })
      captured!.onPlaceholder('m1')
      captured!.onToolResult!('m1', 'tc-1', '"5"', false)
      captured!.onToolResult!('m1', 'tc-1', '"5"', false)

      const messages = useSessionStore.getState().messagesCache.s1
      expect(messages.filter(m => m.id === 'tool-tc-1')).toHaveLength(1)
    })
  })

  describe('onAborted 部分内容展示（修补 d）', () => {
    it('marks the message aborted and overrides content with server partialContent', async () => {
      await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })
      captured!.onPlaceholder('m1')
      captured!.onDelta('本地累积')
      captured!.onAborted('服务端部分内容', 'm1')

      expect(getMessage('m1')).toMatchObject({
        status: 'aborted',
        content: '服务端部分内容',
      })
    })

    it('keeps locally accumulated content when the aborted payload carries nothing', async () => {
      await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })
      captured!.onPlaceholder('m1')
      captured!.onDelta('本地累积')
      captured!.onAborted()

      expect(getMessage('m1')).toMatchObject({
        status: 'aborted',
        content: '本地累积',
      })
    })
  })

  describe('onError 错误码 / onDone messageId 消费（修补 e）', () => {
    it('merges the SSE error code into the failed message error field', async () => {
      await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })
      captured!.onPlaceholder('m1')
      captured!.onError('API error', 'stream_error')

      expect(getMessage('m1')).toMatchObject({
        status: 'failed',
        error: 'stream_error: API error',
      })
    })

    it('keeps the plain message when no error code is present', async () => {
      await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })
      captured!.onPlaceholder('m1')
      captured!.onError('API error')

      expect(getMessage('m1')?.error).toBe('API error')
    })

    it('targets the done messageId instead of the last sending assistant', async () => {
      await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })
      captured!.onPlaceholder('m1')
      // 追加第二条 sending assistant，模拟多轮占位场景
      const m2: Message = {
        id: 'm2',
        sessionId: 's1',
        role: 'assistant',
        content: '',
        attachments: [],
        status: 'sending',
        createdAt: Date.now(),
      }
      useSessionStore.setState((state) => ({
        messagesCache: { s1: [...state.messagesCache.s1, m2] },
      }))

      captured!.onDone('T', 'final', 'm1')

      expect(getMessage('m1')).toMatchObject({ status: 'sent', content: 'final' })
      expect(getMessage('m2')?.status).toBe('sending')
    })
  })

  describe('onJobStatus 接线（修补 h）', () => {
    it('marks the placeholder failed with the job error on job_status failed', async () => {
      await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })
      captured!.onPlaceholder('m1')

      captured!.onJobStatus!('job-1', 'failed', undefined, 'worker 崩溃')

      expect(getMessage('m1')).toMatchObject({ status: 'failed', error: 'worker 崩溃' })
      expect(useSessionStore.getState().agentState).toBe('error')
    })

    it('marks the placeholder aborted on job_status cancelled', async () => {
      await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })
      captured!.onPlaceholder('m1')

      captured!.onJobStatus!('job-1', 'cancelled')

      expect(getMessage('m1')?.status).toBe('aborted')
      expect(useSessionStore.getState().agentState).toBe('cancelled')
    })

    it('marks the placeholder sent on job_status done', async () => {
      await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })
      captured!.onPlaceholder('m1')

      captured!.onJobStatus!('job-1', 'done')

      expect(getMessage('m1')?.status).toBe('sent')
      expect(useSessionStore.getState().agentState).toBe('idle')
    })
  })
})
