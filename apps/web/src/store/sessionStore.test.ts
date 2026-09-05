import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '@my-copilot/shared'

vi.mock('../api', () => ({
  api: {
    sendMessage: vi.fn(),
    stopStream: vi.fn().mockResolvedValue(undefined),
  },
}))

import { api } from '../api'
import { useSessionStore } from './sessionStore'

/** 构造 SSE 文本帧 */
function sseFrame(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function makeSendingAssistant(id: string, content = ''): Message {
  return {
    id,
    sessionId: 's1',
    role: 'assistant',
    content,
    attachments: [],
    status: 'sending',
    createdAt: Date.now(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
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

describe('sessionStore attachment send failures', () => {
  it('marks the optimistic user message failed and rethrows the server error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const error = new Error('Attachment parsing failed: broken.docx: Corrupted ZIP archive')
    vi.mocked(api.sendMessage).mockRejectedValue(error)
    const file = new File(['broken'], 'broken.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    await expect(useSessionStore.getState().sendMessage({
      sessionId: 's1',
      content: 'read this',
      files: [file],
    })).rejects.toThrow(error.message)

    const [message] = useSessionStore.getState().messagesCache.s1
    expect(message).toMatchObject({
      role: 'user',
      status: 'failed',
      error: error.message,
    })
  })
})

describe('message timeline (回归：思考/前导文本写进气泡又被 onDone 删除)', () => {
  it('全流程：lead 快照进时间线、气泡清空、工具条目携带参数与结果、done 后时间线保留', async () => {
    const chunks = [
      sseFrame('placeholder', { msgId: 'srv-1' }),
      sseFrame('reasoning', { text: '先想想…' }),
      sseFrame('delta', { content: '好的，我来调用' }),
      sseFrame('tool_call_start', { messageId: 'srv-1', index: 0 }),
      sseFrame('tool_call_delta', { messageId: 'srv-1', index: 0, name: 'resolve-library-id' }),
      sseFrame('tool_call_done', {
        messageId: 'srv-1', index: 0, id: 'tc-1',
        name: 'resolve-library-id', arguments: '{"libraryName":"React"}',
      }),
      sseFrame('tool_result', {
        messageId: 'srv-1', toolCallId: 'tc-1',
        result: '[{"type":"text","text":"ok"}]', isError: false,
      }),
      sseFrame('delta', { content: '基于结果回答' }),
      sseFrame('done', { title: '', content: '基于结果回答' }),
    ]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })
    vi.mocked(api.sendMessage).mockResolvedValue({ mode: 'sync', stream } as never)

    await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })

    const placeholder = useSessionStore.getState().messagesCache.s1.find((m) => m.id === 'srv-1')!
    // 正文只承载最终回答（lead 不再写进气泡后被删）
    expect(placeholder.content).toBe('基于结果回答')
    expect(placeholder.status).toBe('sent')

    const timeline = (placeholder as { timeline?: unknown[] }).timeline
    expect(timeline).toBeDefined()
    const entries = timeline as Array<Record<string, unknown>>
    expect(entries).toHaveLength(3)
    // 1. reasoning 条目：文本累积 + 回答开始后 done
    expect(entries[0]).toMatchObject({ kind: 'reasoning', text: '先想想…', done: true })
    // 2. lead 条目：本轮前导文本快照
    expect(entries[1]).toMatchObject({ kind: 'lead', text: '好的，我来调用' })
    // 3. tool 条目：真实 id/名称/参数/结果/耗时
    expect(entries[2]).toMatchObject({
      kind: 'tool', id: 'tc-1', name: 'resolve-library-id',
      status: 'done', args: '{"libraryName":"React"}',
      result: '[{"type":"text","text":"ok"}]', isError: false,
    })
    expect(entries[2]!.endedAt).toBeGreaterThan(0)
  })

  it('tool_result isError=true 时条目状态为 error', async () => {
    const chunks = [
      sseFrame('placeholder', { msgId: 'srv-2' }),
      sseFrame('tool_call_start', { messageId: 'srv-2', index: 0 }),
      sseFrame('tool_call_done', {
        messageId: 'srv-2', index: 0, id: 'tc-x', name: 'boom', arguments: '{}',
      }),
      sseFrame('tool_result', {
        messageId: 'srv-2', toolCallId: 'tc-x', result: '[{"type":"text","text":"err"}]', isError: true,
      }),
      sseFrame('done', { title: '', content: '失败了' }),
    ]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { for (const c of chunks) controller.enqueue(c); controller.close() },
    })
    vi.mocked(api.sendMessage).mockResolvedValue({ mode: 'sync', stream } as never)

    await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })

    const placeholder = useSessionStore.getState().messagesCache.s1.find((m) => m.id === 'srv-2')!
    const entries = (placeholder as { timeline?: Array<Record<string, unknown>> }).timeline!
    expect(entries[0]).toMatchObject({ kind: 'tool', id: 'tc-x', status: 'error', isError: true })
  })

  it('aborted 终态把仍在 running 的工具条目收尾为 done，时间线保留', async () => {
    const chunks = [
      sseFrame('placeholder', { msgId: 'srv-3' }),
      sseFrame('delta', { content: '调用中' }),
      sseFrame('tool_call_start', { messageId: 'srv-3', index: 0 }),
      sseFrame('tool_call_done', {
        messageId: 'srv-3', index: 0, id: 'tc-z', name: 'slow', arguments: '{}',
      }),
      sseFrame('aborted', {}),
    ]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { for (const c of chunks) controller.enqueue(c); controller.close() },
    })
    vi.mocked(api.sendMessage).mockResolvedValue({ mode: 'sync', stream } as never)

    await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })

    const placeholder = useSessionStore.getState().messagesCache.s1.find((m) => m.id === 'srv-3')!
    expect(placeholder.status).toBe('aborted')
    const entries = (placeholder as { timeline?: Array<Record<string, unknown>> }).timeline!
    expect(entries[0]).toMatchObject({ kind: 'lead', text: '调用中' })
    expect(entries[1]).toMatchObject({ kind: 'tool', id: 'tc-z', status: 'done' })
  })
})

describe('stream terminal-state cleanup (回归：abort 后占位消息卡在 sending)', () => {
  it('cancelStream 将 sending 状态的 assistant 占位消息标记为 aborted', () => {
    useSessionStore.setState({
      messagesCache: {
        s1: [
          {
            id: 'u1',
            sessionId: 's1',
            role: 'user',
            content: '挑一个工具调用一下',
            attachments: [],
            status: 'sent',
            createdAt: Date.now(),
          },
          makeSendingAssistant('srv-1', '好的，我来调用…'),
        ],
      },
      abortController: new AbortController(),
      isSending: true,
    })

    useSessionStore.getState().cancelStream()

    const placeholder = useSessionStore
      .getState()
      .messagesCache.s1.find((m) => m.id === 'srv-1')
    expect(placeholder?.status).toBe('aborted')
    expect(useSessionStore.getState().isSending).toBe(false)
  })

  it('SSE 流结束但没有任何终态事件时，占位消息收尾为 aborted 而非永远 sending', async () => {
    // 模拟服务端异常断流：发出 placeholder + delta 后直接 close，
    // 没有 done / error / aborted 事件。
    const chunks = [
      sseFrame('placeholder', { msgId: 'srv-2' }),
      sseFrame('delta', { content: '你好' }),
    ]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })
    vi.mocked(api.sendMessage).mockResolvedValue({ mode: 'sync', stream } as never)

    await useSessionStore.getState().sendMessage({
      sessionId: 's1',
      content: 'hi',
    })

    const placeholder = useSessionStore
      .getState()
      .messagesCache.s1.find((m) => m.id === 'srv-2')
    // 回归断言：修复前占位消息停留在 sending（僵尸消息）
    expect(placeholder?.status).toBe('aborted')
    // 已流出的内容保留，不清空
    expect(placeholder?.content).toBe('你好')
    expect(useSessionStore.getState().isSending).toBe(false)
  })
})
