// streamUtils.test.ts — parseSSEStream 的 onReasoning（Extended Thinking）分支测试。
// 其余 SSE case 由 sessionStore / useJobStream 测试间接覆盖，这里聚焦新增能力。

import { describe, expect, it, vi } from 'vitest'
import { parseSSEStream } from './streamUtils'

/** parseSSEStream 的必选 handler 一律给 mock；每个测试按需补充可选 handler。 */
function makeRequiredHandlers() {
  return {
    onPlaceholder: vi.fn(),
    onDelta: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
    onAborted: vi.fn(),
  }
}

/** 由 SSE 文本块构造单次读入的 ReadableStream。 */
function sseStream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

describe('parseSSEStream onReasoning', () => {
  it('invokes onReasoning with text for each reasoning event', async () => {
    const handlers = makeRequiredHandlers()
    const onReasoning = vi.fn()

    await parseSSEStream({
      ...handlers,
      onReasoning,
      stream: sseStream(
        'event: reasoning\ndata: {"text":"让我先想想"}\n\n',
        'event: reasoning\ndata: {"text":"，需要查一下"}\n\n',
      ),
    })

    expect(onReasoning).toHaveBeenCalledTimes(2)
    expect(onReasoning).toHaveBeenNthCalledWith(1, '让我先想想')
    expect(onReasoning).toHaveBeenNthCalledWith(2, '，需要查一下')
  })

  it('keeps reasoning and content deltas separate', async () => {
    const handlers = makeRequiredHandlers()
    const onReasoning = vi.fn()

    await parseSSEStream({
      ...handlers,
      onReasoning,
      stream: sseStream(
        'event: reasoning\ndata: {"text":"推理片段"}\n\n',
        'event: delta\ndata: {"content":"正文片段"}\n\n',
      ),
    })

    expect(onReasoning).toHaveBeenCalledTimes(1)
    expect(onReasoning).toHaveBeenCalledWith('推理片段')
    expect(handlers.onDelta).toHaveBeenCalledTimes(1)
    expect(handlers.onDelta).toHaveBeenCalledWith('正文片段')
  })

  it('does not throw when onReasoning is not provided', async () => {
    const handlers = makeRequiredHandlers()

    await expect(
      parseSSEStream({
        ...handlers,
        stream: sseStream('event: reasoning\ndata: {"text":"没有 handler"}\n\n'),
      }),
    ).resolves.toBeUndefined()

    expect(handlers.onError).not.toHaveBeenCalled()
  })

  it('skips the handler when text is missing or empty', async () => {
    const onReasoning = vi.fn()

    await parseSSEStream({
      ...makeRequiredHandlers(),
      onReasoning,
      stream: sseStream(
        'event: reasoning\ndata: {}\n\n',
        'event: reasoning\ndata: {"text":""}\n\n',
      ),
    })

    expect(onReasoning).not.toHaveBeenCalled()
  })

  it('ignores malformed reasoning payloads without throwing', async () => {
    const onReasoning = vi.fn()
    const handlers = makeRequiredHandlers()

    await parseSSEStream({
      ...handlers,
      onReasoning,
      stream: sseStream('event: reasoning\ndata: not-valid-json\n\n'),
    })

    expect(onReasoning).not.toHaveBeenCalled()
    expect(handlers.onError).not.toHaveBeenCalled()
  })
})

describe('parseSSEStream 终态事件载荷透传（done/error/aborted）', () => {
  // 载荷形状以 apps/server/src/streaming/sse-protocol.ts 为准：
  // DoneEvent{messageId,title?,content?} / ErrorEvent{code,message} / AbortedEvent{messageId,partialContent}
  it('passes title/content/messageId through on done', async () => {
    const handlers = makeRequiredHandlers()

    await parseSSEStream({
      ...handlers,
      stream: sseStream('event: done\ndata: {"messageId":"m1","title":"标题","content":"final"}\n\n'),
    })

    expect(handlers.onDone).toHaveBeenCalledWith('标题', 'final', 'm1')
  })

  it('passes the error code through on error', async () => {
    const handlers = makeRequiredHandlers()

    await expect(parseSSEStream({
      ...handlers,
      stream: sseStream('event: error\ndata: {"code":"stream_error","message":"API error"}\n\n'),
    })).rejects.toThrow('SSE error event received')

    expect(handlers.onError).toHaveBeenCalledWith('API error', 'stream_error')
  })

  it('passes partialContent and messageId through on aborted', async () => {
    const handlers = makeRequiredHandlers()

    await parseSSEStream({
      ...handlers,
      stream: sseStream('event: aborted\ndata: {"messageId":"m1","partialContent":"部分内容"}\n\n'),
    })

    expect(handlers.onAborted).toHaveBeenCalledWith('部分内容', 'm1')
  })

  it('calls onAborted with undefined fields when the payload carries neither', async () => {
    const handlers = makeRequiredHandlers()

    await parseSSEStream({
      ...handlers,
      stream: sseStream('event: aborted\ndata: {}\n\n'),
    })

    expect(handlers.onAborted).toHaveBeenCalledWith(undefined, undefined)
  })
})
