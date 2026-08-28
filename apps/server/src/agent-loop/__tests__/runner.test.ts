import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  RunContext,
  RunStepRecord,
  RunTraceRecord,
  StreamEvent,
  Tool,
  ToolCall,
  TraceCollector,
} from '@my-copilot/shared';
import type {
  ProviderAdapter,
  AdapterConfig,
} from '../../llm/base.js';
import type { ToolExecutionResult } from '../../tools/registry.js';
import type {
  createMessage,
  updateMessage,
} from '../../repo/message.js';
import type { AssembleV2Params } from '../../prompt/assembler.js';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test.
// ---------------------------------------------------------------------------

type CreateMessageParams = Parameters<typeof createMessage>[0];
type UpdateMessageParams = Parameters<typeof updateMessage>[1];

const mockCreateMessage = vi.fn<(params: CreateMessageParams) => unknown>();
const mockUpdateMessage = vi.fn<
  (id: string, params: UpdateMessageParams) => unknown
>();

vi.mock('../../repo/message.js', () => ({
  // Lambda 包装（而非直接传 mock）是必须的：vi.mock 工厂被提升到
  // const 声明之前执行，直接引用会触发 TDZ 错误。
  createMessage: (...args: [CreateMessageParams]) => mockCreateMessage(...args),
  updateMessage: (...args: [string, UpdateMessageParams]) =>
    mockUpdateMessage(...args),
  updateMessageContent: vi.fn(),
}));

const mockExecuteToolCall = vi.fn();

vi.mock('../../tools/executor.js', () => ({
  executeToolCall: (...args: unknown[]) => mockExecuteToolCall(...args),
}));

const mockAssembleMessagesV2 = vi.fn<
  (params: AssembleV2Params) => Promise<RunContext>
>();

vi.mock('../../prompt/assembler.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../prompt/assembler.js')
  >();
  return {
    ...actual,
    // Lambda 包装（而非直接传 mock）是必须的：vi.mock 工厂被提升到 const
    // 声明之前执行，直接引用会触发 TDZ 错误。默认实现（委托真实函数）在
    // beforeEach 中设置，使其余用例保持端到端装配；个别用例用
    // mockImplementationOnce 覆盖返回值以断言 Context v2 集成行为。
    assembleMessagesV2: (
      ...args: Parameters<typeof actual.assembleMessagesV2>
    ) => mockAssembleMessagesV2(...args),
  };
});

vi.mock('../../repo/memory.js', () => ({
  // assembleMessagesV2 的 Memory 注入（sessionId 存在时）会读取 SQLite；
  // 测试环境返回空列表以避免触碰真实数据库（读取失败本身也 fail-soft，
  // 但显式置空更确定）。
  listMemories: vi.fn(() => []),
}));

import { runAgentLoop } from '../runner.js';
import type { RunAgentLoopParams, AgentLoopEvent } from '../runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(name = 'echo'): Tool {
  return {
    id: `tool-${name}`,
    name,
    description: `test tool ${name}`,
    inputSchema: { fields: [] },
    type: 'built-in',
    safetyLevel: 'safe',
    sourceMcpId: null,
    policyVersion: `test:${name}:v1`,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeAdapter(streams: AsyncGenerator<StreamEvent>[]): ProviderAdapter {
  let call = 0;
  return {
    type: 'openai',
    chatCompletionStream: () => {
      const gen = streams[call];
      call += 1;
      if (!gen) {
        // Default to an empty stop if the test under-specified.
        return (async function* () {
          yield { type: 'finish' as const, reason: 'stop' as const };
        })();
      }
      return gen;
    },
  };
}

const adapterConfig: AdapterConfig = {
  baseUrl: 'http://localhost',
  apiKey: 'key',
  model: 'test-model',
};

function makeToolCall(
  name: string,
  args: unknown = {},
  id = 'call-1',
): ToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

function toolResult(text: string, isError = false): ToolExecutionResult {
  return { content: [{ type: 'text', text }], isError };
}

function makeParams(
  overrides: Partial<RunAgentLoopParams> = {},
): RunAgentLoopParams {
  return {
    sessionId: 'sess-1',
    userMessageId: 'assistant-msg-1',
    history: [],
    userContent: 'hello',
    tools: [],
    adapter: makeAdapter([]),
    adapterConfig,
    abortSignal: new AbortController().signal,
    onEvent: vi.fn(),
    ...overrides,
  };
}

/** Build an async generator from a fixed list of events. */
function generatorFrom(
  events: StreamEvent[],
): AsyncGenerator<StreamEvent, void, unknown> {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

const events = {
  content: (text: string): StreamEvent => ({ type: 'content', text }),
  toolCallStart: (index: number): StreamEvent => ({
    type: 'tool_call_start',
    index,
  }),
  toolCallDone: (
    index: number,
    id: string,
    name: string,
    args: unknown = {},
  ): StreamEvent => ({
    type: 'tool_call_done',
    index,
    id,
    name,
    arguments: JSON.stringify(args),
  }),
  finish: (reason: 'stop' | 'tool_calls' | 'length'): StreamEvent => ({
    type: 'finish',
    reason,
  }),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runAgentLoop', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // assembleMessagesV2 默认委托真实实现（端到端装配）；显式 reset 以清除
    // 上一用例可能残留的 mockImplementationOnce 队列。
    mockAssembleMessagesV2.mockReset();
    const actualAssembler = await vi.importActual<
      typeof import('../../prompt/assembler.js')
    >('../../prompt/assembler.js');
    mockAssembleMessagesV2.mockImplementation((params) =>
      actualAssembler.assembleMessagesV2(params),
    );
    mockCreateMessage.mockImplementation((p: { role: string }) => ({
      id: `db-${p.role}-${Date.now()}`,
      ...p,
    }));
    mockUpdateMessage.mockReturnValue(undefined);
    mockExecuteToolCall.mockReset();
  });

  // --- 1. Simple completion (no tools) ---------------------------------
  it('completes with status="completed" when LLM emits finish{stop}', async () => {
    const adapter = makeAdapter([
      generatorFrom([
        events.content('Hello'),
        events.content(' world'),
        events.finish('stop'),
      ]),
    ]);
    const onEvent = vi.fn<(event: AgentLoopEvent) => void>();

    const result = await runAgentLoop(makeParams({ adapter, onEvent }));

    expect(result.status).toBe('completed');
    expect(result.content).toBe('Hello world');

    // updateMessage called once with the final content + status sent
    expect(mockUpdateMessage).toHaveBeenCalledWith('assistant-msg-1', {
      content: 'Hello world',
      reasoning: null,
      status: 'sent',
    });

    // agent_loop_end fired with 'completed'
    const endCall = onEvent.mock.calls.find(
      ([e]: [AgentLoopEvent]) => e.type === 'agent_loop_end',
    );
    expect(endCall?.[0]).toMatchObject({
      type: 'agent_loop_end',
      endReason: 'completed',
    });

    // No tool execution attempted.
    expect(mockExecuteToolCall).not.toHaveBeenCalled();
  });

  // --- 2. One tool call round-trip ------------------------------------
  it('executes one tool call then completes on the second iteration', async () => {
    const adapter = makeAdapter([
      generatorFrom([
        events.toolCallStart(0),
        events.toolCallDone(0, 'call-1', 'echo'),
        events.finish('tool_calls'),
      ]),
      generatorFrom([events.content('done'), events.finish('stop')]),
    ]);
    mockExecuteToolCall.mockResolvedValue(toolResult('echoed'));
    const onEvent = vi.fn<(event: AgentLoopEvent) => void>();

    const result = await runAgentLoop(
      makeParams({
        adapter,
        onEvent,
        tools: [makeTool('echo')],
      }),
    );

    expect(result.status).toBe('completed');
    expect(result.content).toBe('done');
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    expect(mockExecuteToolCall).toHaveBeenCalledWith(
      makeToolCall('echo'),
      expect.objectContaining({ sessionId: 'sess-1' }),
    );

    // Tool result event was forwarded.
    const toolResultEvent = onEvent.mock.calls.find(
      ([e]: [AgentLoopEvent]) => e.type === 'tool_result',
    )?.[0];
    expect(toolResultEvent).toMatchObject({
      type: 'tool_result',
      toolResult: { callId: 'call-1', isError: false },
    });

    // Assistant message (with toolCalls) + tool message persisted.
    const createRoleCalls = mockCreateMessage.mock.calls.map(
      (c) => (c[0] as { role: string }).role,
    );
    expect(createRoleCalls).toContain('assistant');
    expect(createRoleCalls).toContain('tool');
  });

  // --- 3. Parallel tool calls -----------------------------------------
  it('executes multiple tool calls concurrently via Promise.all', async () => {
    const adapter = makeAdapter([
      generatorFrom([
        events.toolCallStart(0),
        events.toolCallStart(1),
        events.toolCallDone(0, 'call-a', 'echo'),
        events.toolCallDone(1, 'call-b', 'lookup'),
        events.finish('tool_calls'),
      ]),
      generatorFrom([events.finish('stop')]),
    ]);
    let aResolved = false;
    let bResolved = false;
    mockExecuteToolCall.mockImplementation((tc: ToolCall) => {
      return new Promise((resolve) => {
        // Stagger resolves; ensure both pending at the same time.
        setTimeout(() => {
          if (tc.id === 'call-a') aResolved = true;
          if (tc.id === 'call-b') bResolved = true;
          resolve(toolResult(`${tc.id}-out`));
        }, 10);
      });
    });

    const result = await runAgentLoop(
      makeParams({ adapter, tools: [makeTool('echo'), makeTool('lookup')] }),
    );

    expect(result.status).toBe('completed');
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(2);
    expect(aResolved && bResolved).toBe(true);
  });

  // --- 4. maxIterations exceeded --------------------------------------
  it('returns status="max_iterations" when the model keeps requesting tools', async () => {
    // Every iteration emits a tool call with distinct arguments so the
    // cross-iteration dedupe (attemptedDigests) does not kick in — we want
    // to verify the maxIterations ceiling itself, not the dedupe behavior.
    const foreverTools: AsyncGenerator<StreamEvent>[] = [];
    for (let i = 0; i < 10; i++) {
      foreverTools.push(
        generatorFrom([
          events.toolCallDone(i, `call-${i}`, 'echo', { round: i }),
          events.finish('tool_calls'),
        ]),
      );
    }
    const adapter = makeAdapter(foreverTools);
    mockExecuteToolCall.mockResolvedValue(toolResult('ok'));

    const result = await runAgentLoop(
      makeParams({
        adapter,
        tools: [makeTool('echo')],
        maxIterations: 3,
      }),
    );

    expect(result.status).toBe('max_iterations');
    // Exactly maxIterations LLM calls — not one extra.
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(3);
  });

  // --- 5. Abort before iteration --------------------------------------
  it('returns status="aborted" when the signal fires before any iteration', async () => {
    const ac = new AbortController();
    ac.abort();
    const adapter = makeAdapter([
      generatorFrom([events.finish('stop')]),
    ]);

    const result = await runAgentLoop(
      makeParams({ adapter, abortSignal: ac.signal }),
    );

    expect(result.status).toBe('aborted');
    // LLM never invoked.
    expect(mockUpdateMessage).toHaveBeenCalledWith('assistant-msg-1', {
      content: '',
      reasoning: null,
      status: 'aborted',
    });
  });

  // --- 6. Tool throws → isError forwarded, loop continues --------------
  it('forwards isError=true when a tool fails, and continues the loop', async () => {
    const adapter = makeAdapter([
      generatorFrom([
        events.toolCallDone(0, 'call-1', 'crashy'),
        events.finish('tool_calls'),
      ]),
      generatorFrom([events.finish('stop')]),
    ]);
    mockExecuteToolCall.mockResolvedValue(toolResult('boom', true));
    const onEvent = vi.fn<(event: AgentLoopEvent) => void>();

    const result = await runAgentLoop(
      makeParams({ adapter, onEvent, tools: [makeTool('crashy')] }),
    );

    expect(result.status).toBe('completed');
    const toolResultEvent = onEvent.mock.calls.find(
      ([e]: [AgentLoopEvent]) => e.type === 'tool_result',
    )?.[0];
    expect(
      toolResultEvent?.type === 'tool_result' &&
        toolResultEvent.toolResult.isError,
    ).toBe(true);
  });

  // --- 7. finish reason 'length' --------------------------------------
  it('returns status="length_limited" on finish reason "length"', async () => {
    const adapter = makeAdapter([
      generatorFrom([
        events.content('truncated'),
        events.finish('length'),
      ]),
    ]);

    const result = await runAgentLoop(makeParams({ adapter }));

    expect(result.status).toBe('length_limited');
    expect(result.content).toBe('truncated');
  });

  // --- 8. Empty stream (no finish event) ------------------------------
  it('completes gracefully when the stream yields no finish event', async () => {
    const adapter = makeAdapter([
      generatorFrom([events.content('partial')]),
    ]);

    const result = await runAgentLoop(makeParams({ adapter }));

    // Falls through to the "no toolCalls + no finish" branch.
    expect(result.status).toBe('completed');
    expect(result.content).toBe('partial');
  });

  // --- 9. Tool result persisted to DB ---------------------------------
  it('persists each tool result as a role=tool message to the DB', async () => {
    const adapter = makeAdapter([
      generatorFrom([
        events.toolCallDone(0, 'call-persist', 'echo'),
        events.finish('tool_calls'),
      ]),
      generatorFrom([events.finish('stop')]),
    ]);
    mockExecuteToolCall.mockResolvedValue(
      toolResult('persisted-payload'),
    );

    await runAgentLoop(makeParams({ adapter, tools: [makeTool('echo')] }));

    const toolPersistCall = mockCreateMessage.mock.calls.find(
      ([p]: [{ role: string }]) => p.role === 'tool',
    );
    expect(toolPersistCall).toBeDefined();
    expect(toolPersistCall?.[0]).toMatchObject({
      role: 'tool',
      toolCallId: 'call-persist',
      content: JSON.stringify([{ type: 'text', text: 'persisted-payload' }]),
      status: 'sent',
    });
  });

  // --- 10. History mutation -------------------------------------------
  it('mutates history with assistant + tool messages each tool round', async () => {
    const adapter = makeAdapter([
      generatorFrom([
        events.toolCallDone(0, 'call-h', 'echo'),
        events.finish('tool_calls'),
      ]),
      generatorFrom([events.finish('stop')]),
    ]);
    mockExecuteToolCall.mockResolvedValue(toolResult('h-result'));
    const history: never[] = [];

    const result = await runAgentLoop(
      makeParams({ adapter, history: history as never, tools: [makeTool('echo')] }),
    );

    // History grew by 2: one assistant (toolCalls), one tool.
    expect(history.length).toBe(2);
    expect(result.messages.length).toBe(2);
    expect((history[0] as { role: string }).role).toBe('assistant');
    expect((history[1] as { role: string }).role).toBe('tool');
  });

  // --- 11. All llm_event types forwarded via onEvent ------------------
  it('forwards every stream event type via onEvent({ type: "llm_event" })', async () => {
    const adapter = makeAdapter([
      generatorFrom([
        events.content('hi'),
        events.toolCallStart(0),
        {
          type: 'tool_call_delta',
          index: 0,
          id: 'call-f',
          name: 'echo',
          argumentsDelta: '{"x"',
        },
        events.toolCallDone(0, 'call-f', 'echo'),
        events.finish('tool_calls'),
      ]),
      generatorFrom([events.finish('stop')]),
    ]);
    mockExecuteToolCall.mockResolvedValue(toolResult('ok'));
    const onEvent = vi.fn<(event: AgentLoopEvent) => void>();

    await runAgentLoop(
      makeParams({ adapter, onEvent, tools: [makeTool('echo')] }),
    );

    const llmEvents = onEvent.mock.calls
      .map(([e]: [AgentLoopEvent]) => e)
      .filter((e) => e.type === 'llm_event');
    const emittedTypes = llmEvents.map(
      (e) => (e as { event: { type: string } }).event.type,
    );

    expect(emittedTypes).toContain('content');
    expect(emittedTypes).toContain('tool_call_start');
    expect(emittedTypes).toContain('tool_call_delta');
    expect(emittedTypes).toContain('tool_call_done');
    expect(emittedTypes).toContain('finish');
  });

  // --- 12. LLM exception → status="error" -----------------------------
  it('returns status="error" with a message when the adapter throws', async () => {
    async function* throwing() {
      yield events.content('partial');
      throw new Error('upstream 500');
    }
    const adapter = makeAdapter([throwing()]);

    const result = await runAgentLoop(makeParams({ adapter }));

    expect(result.status).toBe('error');
    expect(result.error).toContain('upstream 500');
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'assistant-msg-1',
      expect.objectContaining({ status: 'failed' }),
    );
  });

  // --- 13. Abort during tool execution --------------------------------
  it('aborts cleanly when the signal fires after tool execution', async () => {
    const ac = new AbortController();
    const adapter = makeAdapter([
      generatorFrom([
        events.toolCallDone(0, 'call-abort', 'echo'),
        events.finish('tool_calls'),
      ]),
    ]);
    mockExecuteToolCall.mockImplementation(() => {
      // Simulate user aborting during tool call.
      ac.abort();
      return Promise.resolve(toolResult('late'));
    });

    const result = await runAgentLoop(
      makeParams({ adapter, abortSignal: ac.signal, tools: [makeTool('echo')] }),
    );

    expect(result.status).toBe('aborted');
  });

  // --- 14. fullContent is NOT accumulated across iterations ------------
  // Regression: previously `fullContent` was declared outside the while loop
  // and every iteration's streamed text was appended to it. Each persisted
  // assistant message (and the placeholder) then contained the concatenation
  // of all prior iterations' text — producing the visible
  // "好的，我来调用一下…好的，我再调用一次…" 5x repetition symptom.
  it('resets content per iteration so assistant messages do not accumulate', async () => {
    const adapter = makeAdapter([
      // Iteration 1: text + tool_call
      generatorFrom([
        events.content('调用一下'),
        events.toolCallDone(0, 'call-a', 'echo'),
        events.finish('tool_calls'),
      ]),
      // Iteration 2: different text + tool_call (distinct args so dedupe
      // does not kick in — this test isolates the content-accumulation bug)
      generatorFrom([
        events.content('再调用一下'),
        events.toolCallDone(0, 'call-b', 'echo', { round: 2 }),
        events.finish('tool_calls'),
      ]),
      // Iteration 3: terminal text
      generatorFrom([events.content('done'), events.finish('stop')]),
    ]);
    mockExecuteToolCall.mockResolvedValue(toolResult('ok'));

    const result = await runAgentLoop(
      makeParams({ adapter, tools: [makeTool('echo')] }),
    );

    // Final returned content = last iteration only, NOT concatenation.
    expect(result.content).toBe('done');

    // Every persisted assistant message contains ONLY its own iteration's
    // text — never the cross-iteration concatenation.
    const assistantCalls = mockCreateMessage.mock.calls
      .map(([p]: [unknown]) => p as { role: string; content: string })
      .filter((p) => p.role === 'assistant' && p.content !== '');
    // One assistant row per tool-call iteration.
    expect(assistantCalls).toHaveLength(2);
    expect(assistantCalls[0]!.content).toBe('调用一下');
    expect(assistantCalls[1]!.content).toBe('再调用一下');

    // Placeholder final update = last iteration's text only.
    const placeholderUpdate = mockUpdateMessage.mock.calls.find(
      ([id, patch]: [string, { content?: string }]) =>
        id === 'assistant-msg-1' &&
        typeof patch.content === 'string' &&
        patch.content.length > 0,
    );
    expect(placeholderUpdate?.[1]).toMatchObject({ content: 'done' });
  });

  // --- 15. Same arguments digest is not re-executed (anti-retry) -------
  // Regression: when a tool call failed (e.g. danger tool rejected/expired,
  // or "Unknown tool" for orphan mcp-provided rows), the errorResult was
  // written as a tool message and the LLM naturally retried the identical
  // call. Without dedupe, the loop re-triggered confirmation prompts /
  // resolve-failures until maxIterations — burning tokens and producing the
  // death-loop symptom.
  //
  // v2: 去重切换到 LoopGuard 的 markAttempted（digest 含工具名），executor 的
  // digestToolCallArguments 不再被 runner 调用；同工具同参数仍然 skip。
  it('skips re-execution of tool calls with identical arguments and signals the LLM', async () => {
    const adapter = makeAdapter([
      // Iteration 1: model calls echo with {x:1}
      generatorFrom([
        events.toolCallDone(0, 'call-1', 'echo', { x: 1 }),
        events.finish('tool_calls'),
      ]),
      // Iteration 2: model naively retries with identical args
      generatorFrom([
        events.toolCallDone(0, 'call-2', 'echo', { x: 1 }),
        events.finish('tool_calls'),
      ]),
      // Iteration 3: model gives up
      generatorFrom([events.finish('stop')]),
    ]);
    mockExecuteToolCall.mockResolvedValue(toolResult('echoed'));

    const onEvent = vi.fn<(event: AgentLoopEvent) => void>();
    const result = await runAgentLoop(
      makeParams({ adapter, onEvent, tools: [makeTool('echo')] }),
    );

    expect(result.status).toBe('completed');

    // The real executor ran ONLY once (iteration 1). Iteration 2 was skipped.
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    expect(mockExecuteToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'call-1' }),
      expect.anything(),
    );

    // Both tool calls produced a tool_result event so the LLM sees feedback.
    const toolResultEvents = onEvent.mock.calls
      .map(([e]: [AgentLoopEvent]) => e)
      .filter((e) => e.type === 'tool_result');
    expect(toolResultEvents).toHaveLength(2);

    // First result: real execution, no error.
    expect(toolResultEvents[0]).toMatchObject({
      type: 'tool_result',
      toolResult: { callId: 'call-1', isError: false },
    });

    // Second result: synthetic skipped marker, flagged as error.
    expect(toolResultEvents[1]).toMatchObject({
      type: 'tool_result',
      toolResult: { callId: 'call-2', isError: true },
    });
    const skippedPayload = JSON.parse(
      toolResultEvents[1]!.toolResult.result,
    ) as Array<{ type: string; text: string }>;
    expect(skippedPayload[0]!.text).toMatch(/already attempted/i);

    // Both tool messages persisted to history (so the LLM sees them next round).
    const toolPersistCalls = mockCreateMessage.mock.calls
      .map(([p]: [unknown]) => p as { role: string; toolCallId?: string })
      .filter((p) => p.role === 'tool');
    expect(toolPersistCalls).toHaveLength(2);
    expect(toolPersistCalls.map((p) => p.toolCallId).sort()).toEqual(
      ['call-1', 'call-2'].sort(),
    );
  });

  // --- 16. 不同工具同参数不再被误杀（v2 digest 含工具名） -------------
  // v1 的 digestToolCallArguments 只对参数做 sha256：两个不同工具携带相同
  // 参数（如都以 {x:1} 调用）时第二个会被误判为重复而跳过执行。v2 loop-guard
  // 的 digestToolCall 把工具名纳入 digest 输入（name + ':' + canonicalArgs），
  // 修复该误判。
  it('does not skip a different tool called with identical arguments', async () => {
    const adapter = makeAdapter([
      generatorFrom([
        events.toolCallDone(0, 'call-a', 'echo', { x: 1 }),
        events.finish('tool_calls'),
      ]),
      generatorFrom([
        events.toolCallDone(0, 'call-b', 'lookup', { x: 1 }),
        events.finish('tool_calls'),
      ]),
      generatorFrom([events.finish('stop')]),
    ]);
    mockExecuteToolCall.mockResolvedValue(toolResult('ok'));

    const result = await runAgentLoop(
      makeParams({ adapter, tools: [makeTool('echo'), makeTool('lookup')] }),
    );

    expect(result.status).toBe('completed');
    // 两个调用都真实执行（v1 下第二次会被合成为 skipped 结果）。
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(2);

    // 没有 "already attempted" 的 skipped 标记被持久化。
    const skippedPersists = mockCreateMessage.mock.calls
      .map(([p]: [unknown]) => p as { role: string; content?: string })
      .filter(
        (p) =>
          p.role === 'tool' &&
          p.content !== undefined &&
          p.content.includes('already attempted'),
      );
    expect(skippedPersists).toHaveLength(0);
  });

  // --- 17. Context v2 装配集成（assembleMessagesV2 被调用且参数正确） --
  it('assembles prompts via assembleMessagesV2 and passes RunContext.messages to the adapter', async () => {
    const runContext: RunContext = {
      messages: [
        { role: 'system', content: 'sys-prompt' },
        { role: 'user', content: 'hello' },
      ],
      budget: {
        system: 1,
        tools: 2,
        history: 3,
        toolOutputs: 4,
        working: 5,
        headroom: 6,
        total: 21,
      },
      degraded: false,
    };
    mockAssembleMessagesV2.mockImplementationOnce(async () => runContext);

    const streamCalls: unknown[] = [];
    const adapter: ProviderAdapter = {
      type: 'openai',
      chatCompletionStream: (messages) => {
        streamCalls.push(messages);
        return generatorFrom([events.content('v2'), events.finish('stop')]);
      },
    };

    const result = await runAgentLoop(makeParams({ adapter }));

    expect(result.status).toBe('completed');
    expect(result.content).toBe('v2');

    // assembleMessagesV2 被调用一次，sessionId/adapter/strategy 参数正确。
    expect(mockAssembleMessagesV2).toHaveBeenCalledTimes(1);
    const assembleParams = mockAssembleMessagesV2.mock.calls[0]![0];
    expect(assembleParams).toMatchObject({
      sessionId: 'sess-1',
      userContent: 'hello',
      strategy: 'sliding_window',
    });
    expect(assembleParams.adapter).toBe(adapter);
    expect(assembleParams.adapterConfig).toBe(adapterConfig);

    // RunContext.messages 直通传给 adapter（直通转换不改字段值）。
    expect(streamCalls[0]).toEqual(runContext.messages);
  });

  // --- 18. Extended Thinking reasoning 透传（RFC §3） ------------------
  it('forwards reasoning events via llm_event and keeps them out of content', async () => {
    const adapter = makeAdapter([
      generatorFrom([
        { type: 'reasoning', text: '内心推理' },
        events.content('可见回复'),
        events.finish('stop'),
      ]),
    ]);
    const onEvent = vi.fn<(event: AgentLoopEvent) => void>();

    const result = await runAgentLoop(makeParams({ adapter, onEvent }));

    expect(result.status).toBe('completed');
    // reasoning 增量不计入最终回复内容。
    expect(result.content).toBe('可见回复');

    // reasoning 事件照常以 llm_event 透传（wire 映射属 lifecycle/T14）。
    const reasoningEvents = onEvent.mock.calls
      .map(([e]: [AgentLoopEvent]) => e)
      .filter((e) => e.type === 'llm_event' && e.event.type === 'reasoning');
    expect(reasoningEvents).toHaveLength(1);
    expect(reasoningEvents[0]).toMatchObject({
      type: 'llm_event',
      event: { type: 'reasoning', text: '内心推理' },
    });
  });

  // --- 18b. reasoning 持久化（计划 todo 13） ---------------------------
  it('persists the accumulated reasoning with the terminal assistant message', async () => {
    const adapter = makeAdapter([
      generatorFrom([
        { type: 'reasoning', text: '用户问的是加法，' },
        { type: 'reasoning', text: '结果是 5' },
        events.content('答案是 5'),
        events.finish('stop'),
      ]),
    ]);

    await runAgentLoop(makeParams({ adapter }));

    // 终轮占位 assistant 消息带拼接全文的 reasoning（空串归一为 null 除外）。
    expect(mockUpdateMessage).toHaveBeenCalledWith('assistant-msg-1', {
      content: '答案是 5',
      status: 'sent',
      reasoning: '用户问的是加法，结果是 5',
    });
  });

  it('persists no reasoning (null) when the round emits none', async () => {
    const adapter = makeAdapter([
      generatorFrom([events.content('直答'), events.finish('stop')]),
    ]);

    await runAgentLoop(makeParams({ adapter }));

    expect(mockUpdateMessage).toHaveBeenCalledWith('assistant-msg-1', {
      content: '直答',
      status: 'sent',
      reasoning: null,
    });
  });

  it('persists per-round reasoning on tool-call round messages', async () => {
    const adapter = makeAdapter([
      generatorFrom([
        { type: 'reasoning', text: '第一轮：需要工具' },
        events.toolCallStart(0),
        events.toolCallDone(0, 'call-1', 'echo'),
        events.finish('tool_calls'),
      ]),
      generatorFrom([
        { type: 'reasoning', text: '第二轮：' },
        { type: 'reasoning', text: '汇总结果' },
        events.content('done'),
        events.finish('stop'),
      ]),
    ]);
    mockExecuteToolCall.mockResolvedValue(toolResult('echoed'));

    await runAgentLoop(makeParams({ adapter, tools: [makeTool('echo')] }));

    // 工具轮的 assistant 消息（带 toolCalls）持久化该轮 reasoning。
    const assistantCreate = mockCreateMessage.mock.calls
      .map(([p]: [CreateMessageParams]) => p)
      .find((p) => p.role === 'assistant' && p.toolCalls !== undefined);
    expect(assistantCreate).toMatchObject({ reasoning: '第一轮：需要工具' });

    // 终轮占位消息只带最后一轮的 reasoning（与 content 的每轮重置语义一致）。
    expect(mockUpdateMessage).toHaveBeenCalledWith('assistant-msg-1', {
      content: 'done',
      status: 'sent',
      reasoning: '第二轮：汇总结果',
    });
  });

  // --- 19. 装配降级时的中文 debug 日志（仅 degraded=true 打印） --------
  it('logs a Chinese debug line with budget info only when assembly is degraded', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      // 第一次装配：显式降级，history 桶预算 42 tokens。
      mockAssembleMessagesV2.mockImplementationOnce(async () => ({
        messages: [{ role: 'user', content: 'hello' }],
        budget: {
          system: 1,
          tools: 2,
          history: 42,
          toolOutputs: 3,
          working: 4,
          headroom: 5,
          total: 57,
        },
        degraded: true,
      }));
      const degradedRun = await runAgentLoop(
        makeParams({ adapter: makeAdapter([generatorFrom([events.finish('stop')])]) }),
      );
      expect(degradedRun.status).toBe('completed');
      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(String(debugSpy.mock.calls[0]![0])).toMatch(/降级/);
      expect(String(debugSpy.mock.calls[0]![0])).toContain('42');

      // 第二次装配：默认委托真实实现（degraded=false），不再打印。
      await runAgentLoop(
        makeParams({ adapter: makeAdapter([generatorFrom([events.finish('stop')])]) }),
      );
      expect(debugSpy).toHaveBeenCalledTimes(1);
    } finally {
      debugSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// TraceCollector 采集（旁路观察者）
// ---------------------------------------------------------------------------

/** fake collector 记录到的一次调用。 */
type TraceCall =
  | { kind: 'run_start'; run: Partial<RunTraceRecord> }
  | { kind: 'step'; step: RunStepRecord }
  | { kind: 'run_end'; run: Partial<RunTraceRecord> };

function expectRunStart(call: TraceCall | undefined): Partial<RunTraceRecord> {
  if (call === undefined || call.kind !== 'run_start') {
    throw new Error(`expected run_start call, got ${call?.kind ?? 'none'}`);
  }
  return call.run;
}

function expectRunEnd(call: TraceCall | undefined): Partial<RunTraceRecord> {
  if (call === undefined || call.kind !== 'run_end') {
    throw new Error(`expected run_end call, got ${call?.kind ?? 'none'}`);
  }
  return call.run;
}

function makeTraceCollector(
  overrides: Partial<TraceCollector> = {},
): { collector: TraceCollector; calls: TraceCall[] } {
  const calls: TraceCall[] = [];
  return {
    calls,
    collector: {
      onRunStart: (run) => {
        calls.push({ kind: 'run_start', run });
      },
      onStep: (step) => {
        calls.push({ kind: 'step', step });
      },
      onRunEnd: (run) => {
        calls.push({ kind: 'run_end', run });
      },
      ...overrides,
    },
  };
}

describe('runAgentLoop · TraceCollector 采集', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockAssembleMessagesV2.mockReset();
    const actualAssembler = await vi.importActual<
      typeof import('../../prompt/assembler.js')
    >('../../prompt/assembler.js');
    mockAssembleMessagesV2.mockImplementation((params) =>
      actualAssembler.assembleMessagesV2(params),
    );
    mockCreateMessage.mockImplementation((p: { role: string }) => ({
      id: `db-${p.role}-${Date.now()}`,
      ...p,
    }));
    mockUpdateMessage.mockReturnValue(undefined);
    mockExecuteToolCall.mockReset();
  });

  // --- T1. 事件顺序与字段：run_start → llm_call/tool_exec 步骤 → run_end --
  it('emits run_start → llm_call → tool_exec → llm_call → run_end in order with fields', async () => {
    const adapter = makeAdapter([
      generatorFrom([
        events.toolCallDone(0, 'call-1', 'echo', { x: 1 }),
        events.finish('tool_calls'),
      ]),
      generatorFrom([events.content('done'), events.finish('stop')]),
    ]);
    // 延迟 10ms 的工具执行：tool_exec step 的 durationMs 可确定性断言 > 0。
    mockExecuteToolCall.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(toolResult('echoed')), 10);
        }),
    );
    const { collector, calls } = makeTraceCollector();

    const result = await runAgentLoop(
      makeParams({ adapter, tools: [makeTool('echo')], trace: collector }),
    );

    expect(result.status).toBe('completed');

    // 事件顺序：run_start → 3 steps → run_end。
    expect(calls.map((c) => c.kind)).toEqual([
      'run_start',
      'step',
      'step',
      'step',
      'run_end',
    ]);
    // 步骤类型与 seq：llm_call(1) → tool_exec(2) → llm_call(3)。
    const steps = calls.flatMap((c) => (c.kind === 'step' ? [c.step] : []));
    expect(steps.map((s) => s.type)).toEqual(['llm_call', 'tool_exec', 'llm_call']);
    expect(steps.map((s) => s.seq)).toEqual([1, 2, 3]);

    // run_start 字段：runner 语境的标识 + in_progress；
    // userMessageId（真实用户消息 id）不由 runner 提供（采集器构造方注入）。
    const runStart = expectRunStart(calls[0]);
    expect(runStart).toMatchObject({
      sessionId: 'sess-1',
      assistantMessageId: 'assistant-msg-1',
      agentId: 'default',
      status: 'in_progress',
    });
    expect(runStart.userMessageId).toBeUndefined();

    // tool_exec step 字段：工具名 / 参数预览 / 结果预览 / 非错误 / 计时。
    const toolStep = steps[1]!;
    expect(toolStep.toolName).toBe('echo');
    expect(toolStep.argsPreview).toBe('{"x":1}');
    expect(toolStep.resultPreview).toContain('echoed');
    expect(toolStep.isError).toBe(false);
    expect(toolStep.durationMs).toBeGreaterThan(0);

    // llm_call step 字段：非工具步骤 + 该轮 token 估算进 resultPreview。
    for (const llmStep of [steps[0]!, steps[2]!]) {
      expect(llmStep.toolName).toBeNull();
      expect(llmStep.isError).toBe(false);
      expect(llmStep.resultPreview).toMatch(/tokens$/);
      expect(llmStep.durationMs).toBeGreaterThanOrEqual(0);
    }

    // run_end 字段：终态 / 迭代数 / 最后一轮预算 / token 估算。
    const runEnd = expectRunEnd(calls[calls.length - 1]);
    expect(runEnd).toMatchObject({
      status: 'completed',
      stopReason: 'end_turn',
      iterations: 2,
      degraded: false,
    });
    expect(runEnd.totalTokens).toBeGreaterThan(0);
    expect(runEnd.budgetSnapshot).not.toBeNull();
    expect(runEnd.endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // --- T2. maxSteps 终止：run_end 记 incomplete / max_steps ---------------
  it('records status="incomplete" and stopReason="max_steps" when maxSteps terminates', async () => {
    const foreverTools: AsyncGenerator<StreamEvent>[] = [];
    for (let i = 0; i < 3; i++) {
      foreverTools.push(
        generatorFrom([
          events.toolCallDone(i, `call-${i}`, 'echo', { round: i }),
          events.finish('tool_calls'),
        ]),
      );
    }
    mockExecuteToolCall.mockResolvedValue(toolResult('ok'));
    const { collector, calls } = makeTraceCollector();

    const result = await runAgentLoop(
      makeParams({
        adapter: makeAdapter(foreverTools),
        tools: [makeTool('echo')],
        maxIterations: 3,
        trace: collector,
      }),
    );

    expect(result.status).toBe('max_iterations');
    const runEnd = expectRunEnd(calls[calls.length - 1]);
    expect(runEnd).toMatchObject({
      status: 'incomplete',
      stopReason: 'max_steps',
      iterations: 3,
    });
    // 3 轮 llm_call + 3 次 tool_exec。
    const steps = calls.flatMap((c) => (c.kind === 'step' ? [c.step] : []));
    expect(steps.filter((s) => s.type === 'llm_call')).toHaveLength(3);
    expect(steps.filter((s) => s.type === 'tool_exec')).toHaveLength(3);
  });

  // --- T3. collector 抛错不中断 loop --------------------------------------
  it('completes the loop and console.warns when the collector throws on onStep', async () => {
    const adapter = makeAdapter([
      generatorFrom([
        events.toolCallDone(0, 'call-1', 'echo'),
        events.finish('tool_calls'),
      ]),
      generatorFrom([events.content('done'), events.finish('stop')]),
    ]);
    mockExecuteToolCall.mockResolvedValue(toolResult('ok'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { collector, calls } = makeTraceCollector({
      onStep: () => {
        throw new Error('collector exploded');
      },
    });

    try {
      const result = await runAgentLoop(
        makeParams({ adapter, tools: [makeTool('echo')], trace: collector }),
      );

      // loop 照常完成，不受采集器故障影响。
      expect(result.status).toBe('completed');
      expect(result.content).toBe('done');
      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
      // 采集器异常被吞掉并 console.warn。
      expect(warnSpy).toHaveBeenCalled();
      expect(
        warnSpy.mock.calls.some(([msg]) => String(msg).includes('trace')),
      ).toBe(true);
      // run_start / run_end 仍被记录（仅 onStep 抛错）。
      expect(calls.map((c) => c.kind)).toEqual(['run_start', 'run_end']);
    } finally {
      warnSpy.mockRestore();
    }
  });

  // --- T4. abort 终态：run_end 记 cancelled / user_interrupt --------------
  it('records status="cancelled" and stopReason="user_interrupt" when aborted before any iteration', async () => {
    const ac = new AbortController();
    ac.abort();
    const { collector, calls } = makeTraceCollector();

    const result = await runAgentLoop(
      makeParams({
        adapter: makeAdapter([generatorFrom([events.finish('stop')])]),
        abortSignal: ac.signal,
        trace: collector,
      }),
    );

    expect(result.status).toBe('aborted');
    // 无迭代 → 无步骤事件。
    expect(calls.map((c) => c.kind)).toEqual(['run_start', 'run_end']);
    const runEnd = expectRunEnd(calls[calls.length - 1]);
    expect(runEnd).toMatchObject({
      status: 'cancelled',
      stopReason: 'user_interrupt',
      iterations: 0,
    });
  });
});
