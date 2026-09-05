// timeline.test.ts — attachTimelines（刷新后时间线重建）单元测试
import { describe, expect, it } from 'vitest'
import type { Message, ToolCall } from '@my-copilot/shared'
import { attachTimelines, asTimelineMessages } from './timeline'
import type { MessageWithTimeline, TimelineEntry } from '../types/timeline'

function msg(overrides: Partial<Message>): Message {
  return {
    id: 'm',
    sessionId: 's1',
    role: 'user',
    content: '',
    attachments: [],
    status: 'sent',
    createdAt: 0,
    ...overrides,
  }
}

function tc(id: string, name: string, args: string): ToolCall {
  return { id, name, arguments: args }
}

function timelineOf(m: MessageWithTimeline | undefined): TimelineEntry[] {
  return m?.timeline ?? []
}

describe('attachTimelines', () => {
  it('把中间轮聚组到终态 assistant：lead + 工具条目 + 结果回填，中间消息剔除', () => {
    const input = asTimelineMessages([
      msg({ id: 'u1', role: 'user', content: '调用一下工具' }),
      msg({ id: 'a1', role: 'assistant', content: '好的，我来调用…', toolCalls: [tc('t1', 'resolve-library-id', '{"libraryName":"React"}')] }),
      msg({ id: 'r1', role: 'tool', content: '[{"type":"text","text":"libs"}]', toolCallId: 't1' }),
      msg({ id: 'a2', role: 'assistant', content: '基于结果回答', toolCalls: [tc('t2', 'query-docs', '{"query":"useState"}')] }),
      msg({ id: 'r2', role: 'tool', content: '[{"type":"text","text":"docs"}]', toolCallId: 't2' }),
      msg({ id: 'final', role: 'assistant', content: '最终回答' }),
    ])

    const out = attachTimelines(input)

    // 输出只有 user + 终态 assistant（中间 4 条被聚组吸收）
    expect(out.map((m) => m.id)).toEqual(['u1', 'final'])
    const entries = timelineOf(out[1])
    expect(entries).toHaveLength(4)
    expect(entries[0]).toMatchObject({ kind: 'lead', text: '好的，我来调用…' })
    expect(entries[1]).toMatchObject({
      kind: 'tool', id: 't1', name: 'resolve-library-id',
      args: '{"libraryName":"React"}', result: '[{"type":"text","text":"libs"}]',
      status: 'done',
    })
    expect(entries[2]).toMatchObject({ kind: 'lead', text: '基于结果回答' })
    expect(entries[3]).toMatchObject({
      kind: 'tool', id: 't2', name: 'query-docs',
      result: '[{"type":"text","text":"docs"}]',
    })
    // 正文是最终回答（lead 不污染）
    expect(out[1]!.content).toBe('最终回答')
  })

  it('live 消息已带 timeline 字段时沿用，不被覆盖', () => {
    const liveTimeline: TimelineEntry[] = [
      { kind: 'reasoning', id: 'r', text: '思考', done: true },
    ]
    const input: MessageWithTimeline[] = [
      { ...msg({ id: 'u1', role: 'user', content: 'q' }) },
      { ...msg({ id: 'final', role: 'assistant', content: 'a' }), timeline: liveTimeline },
    ]
    const out = attachTimelines(input)
    expect(out[1]!.timeline).toBe(liveTimeline)
  })

  it('无中间消息的普通对话原样通过，不带 timeline', () => {
    const input = asTimelineMessages([
      msg({ id: 'u1', role: 'user', content: '你好' }),
      msg({ id: 'a1', role: 'assistant', content: '你好！' }),
    ])
    const out = attachTimelines(input)
    expect(out).toHaveLength(2)
    expect(out[1]!.timeline).toBeUndefined()
  })

  it('aborted 占位（终态 assistant）也能挂上其前的中间轮', () => {
    const input = asTimelineMessages([
      msg({ id: 'u1', role: 'user', content: 'q' }),
      msg({ id: 'a1', role: 'assistant', content: '调用中', toolCalls: [tc('t1', 'slow', '{}')] }),
      msg({ id: 'ph', role: 'assistant', content: '', status: 'aborted' }),
    ])
    const out = attachTimelines(input)
    expect(out.map((m) => m.id)).toEqual(['u1', 'ph'])
    const entries = timelineOf(out[1])
    expect(entries[0]).toMatchObject({ kind: 'lead', text: '调用中' })
    expect(entries[1]).toMatchObject({ kind: 'tool', id: 't1', name: 'slow' })
  })

  it('纯函数：不修改输入消息对象', () => {
    const input = asTimelineMessages([
      msg({ id: 'u1', role: 'user', content: 'q' }),
      msg({ id: 'a1', role: 'assistant', content: 'lead', toolCalls: [tc('t1', 'x', '{}')] }),
      msg({ id: 'r1', role: 'tool', content: 'res', toolCallId: 't1' }),
      msg({ id: 'final', role: 'assistant', content: 'done' }),
    ])
    const snapshot = JSON.stringify(input)
    attachTimelines(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

describe('attachTimelines 真实落库形状（终态占位消息排在中间轮之前）', () => {
  // 服务端 streaming/lifecycle.ts 在 run 开始时创建占位 assistant（终态），
  // 中间轮在其后落库 → ORDER BY created_at 下终态永远在前。
  // 聚组必须与消息顺序无关（形状取自真实会话 2d3d13f5）。

  it('终态在前：仍聚组出完整时间线，并行工具 + 结果回填 + 耗时取自 tool 消息时间戳', () => {
    const input = asTimelineMessages([
      msg({ id: 'u1', role: 'user', content: '帮我查一下今日沪深指数', createdAt: 1000 }),
      msg({ id: 'term', role: 'assistant', content: '已获取收盘数据', createdAt: 1001 }),
      msg({
        id: 'a1', role: 'assistant', content: '', createdAt: 2500,
        toolCalls: [tc('t1', 'web_search', '{"q":"沪深指数"}'), tc('t2', 'http_fetch', '{"url":"example.com"}')],
      }),
      msg({ id: 'r1', role: 'tool', content: 'result-1', toolCallId: 't1', createdAt: 6000 }),
      msg({ id: 'r2', role: 'tool', content: 'result-2', toolCallId: 't2', createdAt: 6001 }),
      msg({
        id: 'a2', role: 'assistant', content: '换个方式再查', createdAt: 8000,
        toolCalls: [tc('t3', 'http_fetch', '{"url":"qt.gtimg.cn"}'), tc('t4', 'web_search', '{"q":"上证指数"}')],
      }),
      msg({ id: 'r3', role: 'tool', content: 'result-3', toolCallId: 't3', createdAt: 9500 }),
      msg({ id: 'r4', role: 'tool', content: 'result-4', toolCallId: 't4', createdAt: 9501 }),
    ])

    const out = attachTimelines(input)

    // 输出：user + 终态（8 条中间消息全部吸收进 timeline）
    expect(out.map((m) => m.id)).toEqual(['u1', 'term'])
    const entries = timelineOf(out[1])
    // a1 content 为空 → 无 lead；a2 带前导语 → [t1, t2, lead, t3, t4]
    expect(entries).toHaveLength(5)
    expect(entries[0]).toMatchObject({
      kind: 'tool', id: 't1', name: 'web_search',
      args: '{"q":"沪深指数"}', result: 'result-1', status: 'done',
    })
    expect(entries[1]).toMatchObject({ kind: 'tool', id: 't2', result: 'result-2' })
    expect(entries[2]).toMatchObject({ kind: 'lead', text: '换个方式再查' })
    expect(entries[3]).toMatchObject({ kind: 'tool', id: 't3', result: 'result-3' })
    expect(entries[4]).toMatchObject({ kind: 'tool', id: 't4', result: 'result-4' })
    // 耗时：startedAt 来自轮次消息，endedAt 修正为工具结果落库时刻（非轮次时刻）
    expect(entries[0]).toMatchObject({ startedAt: 2500, endedAt: 6000 })
    // 终态正文保持最终回答，不被 lead 污染
    expect(out[1]!.content).toBe('已获取收盘数据')
  })

  it('终态在前且为 aborted 占位：同样聚组', () => {
    const input = asTimelineMessages([
      msg({ id: 'u1', role: 'user', content: 'q', createdAt: 1000 }),
      msg({ id: 'ph', role: 'assistant', content: '', status: 'aborted', createdAt: 1001 }),
      msg({ id: 'a1', role: 'assistant', content: '调用中', toolCalls: [tc('t1', 'slow', '{}')], createdAt: 3000 }),
      msg({ id: 'r1', role: 'tool', content: 'res', toolCallId: 't1', createdAt: 5000 }),
    ])
    const out = attachTimelines(input)
    expect(out.map((m) => m.id)).toEqual(['u1', 'ph'])
    const entries = timelineOf(out[1])
    expect(entries[0]).toMatchObject({ kind: 'lead', text: '调用中' })
    expect(entries[1]).toMatchObject({ kind: 'tool', id: 't1', name: 'slow', result: 'res' })
  })

  it('多个 run 连续出现：各自聚组到自己的终态，run 之间互不渗透', () => {
    const input = asTimelineMessages([
      msg({ id: 'u1', role: 'user', content: 'q1', createdAt: 1000 }),
      msg({ id: 'term1', role: 'assistant', content: 'a1-final', createdAt: 1001 }),
      msg({ id: 'a1r', role: 'assistant', content: '', toolCalls: [tc('t1', 'x', '{}')], createdAt: 2000 }),
      msg({ id: 'r1', role: 'tool', content: 'res1', toolCallId: 't1', createdAt: 3000 }),
      msg({ id: 'u2', role: 'user', content: 'q2', createdAt: 10000 }),
      msg({ id: 'term2', role: 'assistant', content: 'a2-final', createdAt: 10001 }),
      msg({ id: 'a2r', role: 'assistant', content: '', toolCalls: [tc('t2', 'y', '{}')], createdAt: 11000 }),
      msg({ id: 'r2', role: 'tool', content: 'res2', toolCallId: 't2', createdAt: 12000 }),
    ])
    const out = attachTimelines(input)
    expect(out.map((m) => m.id)).toEqual(['u1', 'term1', 'u2', 'term2'])
    expect(timelineOf(out[1]).map((e) => e.id)).toEqual(['t1'])
    expect(timelineOf(out[3]).map((e) => e.id)).toEqual(['t2'])
  })

  it('防御：run 内没有终态（数据不完整）时原样输出，不静默吞消息', () => {
    const input = asTimelineMessages([
      msg({ id: 'u1', role: 'user', content: 'q', createdAt: 1000 }),
      msg({ id: 'a1', role: 'assistant', content: 'lead', toolCalls: [tc('t1', 'x', '{}')], createdAt: 2000 }),
      msg({ id: 'r1', role: 'tool', content: 'res', toolCallId: 't1', createdAt: 3000 }),
    ])
    const out = attachTimelines(input)
    // 不聚组、不剔除——数据不完整时宁可退回原样展示
    expect(out.map((m) => m.id)).toEqual(['u1', 'a1', 'r1'])
    expect(out[1]!.timeline).toBeUndefined()
  })

  it('防御：一个 run 内多个终态（非预期形状）时原样输出，不聚组', () => {
    const input = asTimelineMessages([
      msg({ id: 'u1', role: 'user', content: 'q', createdAt: 1000 }),
      msg({ id: 't1a', role: 'assistant', content: '旧回答', createdAt: 1001 }),
      msg({ id: 't1b', role: 'assistant', content: '新回答', createdAt: 9000 }),
    ])
    const out = attachTimelines(input)
    expect(out.map((m) => m.id)).toEqual(['u1', 't1a', 't1b'])
  })
})
