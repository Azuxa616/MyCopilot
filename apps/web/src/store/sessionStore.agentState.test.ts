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
import { transitionAgentState, useSessionStore } from './sessionStore'
import type { AgentState, AgentStateTrigger } from './sessionStore'

const ALL_STATES: readonly AgentState[] = [
  'idle',
  'thinking',
  'tool_running',
  'responding',
  'error',
  'cancelled',
]

/** 全状态 × 全触发器的转移表（含非法前置保持不变的 case）。 */
const TRANSITION_CASES: Array<{
  current: AgentState
  trigger: AgentStateTrigger
  expected: AgentState
}> = [
  // send: idle → thinking；非 idle 保持
  ...ALL_STATES.map((s) => ({
    current: s,
    trigger: 'send' as const,
    expected: (s === 'idle' ? 'thinking' : s) as AgentState,
  })),
  // content_delta: thinking / tool_running → responding；其余保持
  ...ALL_STATES.map((s) => ({
    current: s,
    trigger: 'content_delta' as const,
    expected: (s === 'thinking' || s === 'tool_running' ? 'responding' : s) as AgentState,
  })),
  // tool_call_start: thinking / responding → tool_running；其余保持
  ...ALL_STATES.map((s) => ({
    current: s,
    trigger: 'tool_call_start' as const,
    expected: (s === 'thinking' || s === 'responding' ? 'tool_running' : s) as AgentState,
  })),
  // tool_call_done: 一律保持当前状态
  ...ALL_STATES.map((s) => ({
    current: s,
    trigger: 'tool_call_done' as const,
    expected: s,
  })),
  // 终态触发：任意 → idle / error / cancelled
  ...ALL_STATES.map((s) => ({ current: s, trigger: 'stream_done' as const, expected: 'idle' as const })),
  ...ALL_STATES.map((s) => ({ current: s, trigger: 'stream_error' as const, expected: 'error' as const })),
  ...ALL_STATES.map((s) => ({
    current: s,
    trigger: 'stream_aborted' as const,
    expected: 'cancelled' as const,
  })),
]

describe('transitionAgentState', () => {
  it.each(TRANSITION_CASES)('$current + $trigger → $expected', ({ current, trigger, expected }) => {
    expect(transitionAgentState(current, trigger)).toBe(expected)
  })
})

describe('sessionStore agentState wiring', () => {
  let captured: SSEStreamParams | undefined

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

  it('drives the full thinking → tool_running → responding → idle cycle via SSE handlers', async () => {
    await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })
    expect(captured).toBeDefined()
    const state = () => useSessionStore.getState()

    // send → thinking
    expect(state().agentState).toBe('thinking')

    // placeholder 不触发转移，保持 thinking
    captured!.onPlaceholder('m1')
    expect(state().agentState).toBe('thinking')

    // tool_call_start → tool_running，登记 running 工具
    captured!.onToolCallStart!('m1', 0)
    expect(state().agentState).toBe('tool_running')
    expect(state().activeToolCalls).toEqual([{ id: 'm1:0', name: '', status: 'running' }])

    // tool_call_delta 只补全工具名，不改状态
    captured!.onToolCallDelta!('m1', 0, 'tc-1', 'web_search')
    expect(state().agentState).toBe('tool_running')
    expect(state().activeToolCalls).toEqual([{ id: 'm1:0', name: 'web_search', status: 'running' }])

    // tool_call_done → 保持 tool_running，条目替换为真实 id 并置 done
    captured!.onToolCallDone!('m1', 0, 'tc-1', 'web_search', '{"q":"x"}')
    expect(state().agentState).toBe('tool_running')
    expect(state().activeToolCalls).toEqual([{ id: 'tc-1', name: 'web_search', status: 'done' }])

    // tool_result 到达：保持 done、保持 tool_running
    captured!.onToolResult!('m1', 'tc-1', 'ok', false)
    expect(state().agentState).toBe('tool_running')
    expect(state().activeToolCalls).toEqual([{ id: 'tc-1', name: 'web_search', status: 'done' }])

    // 工具之后的 content delta → responding
    captured!.onDelta('Hello')
    expect(state().agentState).toBe('responding')

    // done → idle，清空 activeToolCalls
    captured!.onDone('T', 'Hello')
    expect(state().agentState).toBe('idle')
    expect(state().activeToolCalls).toEqual([])
  })

  it('transitions to error and clears activeToolCalls on SSE error event', async () => {
    await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })
    captured!.onToolCallStart!('m1', 0)
    captured!.onError('boom')
    expect(useSessionStore.getState().agentState).toBe('error')
    expect(useSessionStore.getState().activeToolCalls).toEqual([])
  })

  it('transitions to cancelled on SSE aborted event', async () => {
    await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })
    captured!.onDelta('partial')
    captured!.onAborted()
    expect(useSessionStore.getState().agentState).toBe('cancelled')
  })

  it('transitions to error when the send request itself fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(api.sendMessage).mockRejectedValue(new Error('network down'))
    await expect(
      useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' }),
    ).rejects.toThrow('network down')
    expect(useSessionStore.getState().agentState).toBe('error')
  })

  it('transitions to cancelled when cancelStream aborts locally', () => {
    const controller = new AbortController()
    useSessionStore.setState({
      abortController: controller,
      isSending: true,
      agentState: 'responding',
    })
    useSessionStore.getState().cancelStream()
    expect(controller.signal.aborted).toBe(true)
    expect(useSessionStore.getState().agentState).toBe('cancelled')
    expect(api.stopStream).toHaveBeenCalledWith('s1')
  })

  it('returns to idle when the background job is cleared (job terminal point)', async () => {
    vi.mocked(api.sendMessage).mockResolvedValue({ mode: 'async', jobId: 'job-1' })
    await useSessionStore.getState().sendMessage({ sessionId: 's1', content: 'hi' })
    expect(useSessionStore.getState().agentState).toBe('thinking')
    expect(useSessionStore.getState().activeJobId).toBe('job-1')

    // ChatShell 在 job 终态（done/failed/cancelled）时以 setActiveJobId(null) 收尾（现有逻辑）
    useSessionStore.getState().setActiveJobId(null)
    expect(useSessionStore.getState().agentState).toBe('idle')
  })
})
