import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StreamEvent, Tool, ToolCall } from '@my-copilot/shared';
import type {
  ProviderAdapter,
  AdapterConfig,
} from '../../llm/base.js';
import type { ToolExecutionResult } from '../../tools/registry.js';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test.
// ---------------------------------------------------------------------------

const mockCreateMessage = vi.fn();
const mockUpdateMessage = vi.fn();

vi.mock('../../repo/message.js', () => ({
  createMessage: (...args: unknown[]) => mockCreateMessage(...args),
  updateMessage: (...args: unknown[]) => mockUpdateMessage(...args),
  updateMessageContent: vi.fn(),
}));

const mockExecuteToolCall = vi.fn();

vi.mock('../../tools/executor.js', () => ({
  executeToolCall: (...args: unknown[]) => mockExecuteToolCall(...args),
}));

// assembler is exercised end-to-end (real implementation) so we can verify
// history mutation surfaces tool messages in subsequent iterations.

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
  beforeEach(() => {
    vi.clearAllMocks();
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
    const onEvent = vi.fn();

    const result = await runAgentLoop(makeParams({ adapter, onEvent }));

    expect(result.status).toBe('completed');
    expect(result.content).toBe('Hello world');

    // updateMessage called once with the final content + status sent
    expect(mockUpdateMessage).toHaveBeenCalledWith('assistant-msg-1', {
      content: 'Hello world',
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
    const onEvent = vi.fn();

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
    // Every iteration emits a tool call; never stops on its own.
    const foreverTools: AsyncGenerator<StreamEvent>[] = [];
    for (let i = 0; i < 10; i++) {
      foreverTools.push(
        generatorFrom([
          events.toolCallDone(i, `call-${i}`, 'echo'),
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
    const onEvent = vi.fn();

    const result = await runAgentLoop(
      makeParams({ adapter, onEvent, tools: [makeTool('crashy')] }),
    );

    expect(result.status).toBe('completed');
    const toolResultEvent = onEvent.mock.calls.find(
      ([e]: [AgentLoopEvent]) => e.type === 'tool_result',
    )?.[0];
    expect(toolResultEvent?.toolResult?.isError).toBe(true);
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
    const onEvent = vi.fn();

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
    function* throwing() {
      yield events.content('partial');
      throw new Error('upstream 500');
    }
    const adapter = makeAdapter([throwing() as AsyncGenerator<StreamEvent>]);

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
});
