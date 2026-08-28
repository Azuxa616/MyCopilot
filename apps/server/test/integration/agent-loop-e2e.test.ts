/**
 * T18 Step A — Agent Loop End-to-End Integration Tests
 *
 * Integration boundary:
 *   REAL    — runner.ts, executor.ts, assembler.ts, registry.ts, schema-adapter.ts
 *   MOCKED  — repo/message.ts (no SQLite), repo/tool.ts, repo/mcp.ts,
 *             mcp/manager.ts (no subprocess), tools/confirmation.ts
 *
 * These tests verify that the agent loop wiring works end-to-end: the runner
 * consumes a (mock) LLM stream, dispatches tool calls through the real
 * executor + registry, persists results via the mocked repo, and emits the
 * correct terminal event. They are NOT HTTP-level E2E tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  Message,
  Tool,
  StreamEvent,
} from '@my-copilot/shared';

// ---------------------------------------------------------------------------
// Module-level mocks — MUST be declared before importing the modules under
// test. vitest hoists vi.mock calls to the top of the file.
// ---------------------------------------------------------------------------

// 1. Message DB — avoid touching SQLite entirely.
vi.mock('../../src/repo/message.js', () => ({
  createMessage: vi.fn((p: { role: string; content?: string }) => ({
    id: `db-${p.role}-${Date.now()}`,
    sessionId: 'sess-1',
    role: p.role,
    content: p.content ?? '',
    attachments: [],
    status: 'sent',
    createdAt: Date.now(),
  })),
  updateMessage: vi.fn(),
  updateMessageContent: vi.fn(),
}));

// 2. Tool DB repo — empty by default; per-test overrides via vi.mocked.
vi.mock('../../src/repo/tool.js', () => ({
  listTools: vi.fn(() => []),
  getToolsByName: vi.fn(() => []),
}));

// 2b. Agent safety override repo — 默认继承工具自身的安全等级。
vi.mock('../../src/repo/agent.js', () => ({
  getAgentToolSafetyOverride: vi.fn(() => 'inherit'),
}));

// 3. MCP DB repo — no enabled MCPs by default.
vi.mock('../../src/repo/mcp.js', () => ({
  listEnabledMcps: vi.fn(() => []),
}));

// 4. MCP manager — never spawns a real subprocess.
vi.mock('../../src/mcp/manager.js', () => ({
  callTool: vi.fn(),
  listTools: vi.fn(),
}));

// 5. Confirmation store — default to approve so danger tools can opt-in.
vi.mock('../../src/tools/confirmation.js', () => ({
  isConfirmedThisSession: vi.fn(() => false),
  markConfirmedThisSession: vi.fn(),
  requestToolApproval: vi.fn(),
}));

// Import AFTER mocks are registered. verbatimModuleSyntax requires `import type`
// for type-only imports.
import { runAgentLoop } from '../../src/agent-loop/runner.js';
import type {
  RunAgentLoopParams,
  AgentLoopEvent,
} from '../../src/agent-loop/runner.js';
import type {
  ProviderAdapter,
  ChatMessage,
} from '../../src/llm/base.js';
import {
  createFakeAdapter,
  recordFromEvents,
  TEST_ADAPTER_CONFIG,
} from '../../src/llm/testing/fake-adapter.js';
import {
  registerTool,
  clearRegisteredTools,
  type ToolExecutor,
} from '../../src/tools/registry.js';
import { listTools, getToolsByName } from '../../src/repo/tool.js';
import { getAgentToolSafetyOverride } from '../../src/repo/agent.js';
import { callTool as mcpCallTool, listTools as listMcpTools } from '../../src/mcp/manager.js';
import { requestToolApproval } from '../../src/tools/confirmation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserMessage(content = 'Hello'): Message {
  return {
    id: 'user-1',
    sessionId: 'sess-1',
    role: 'user',
    content,
    status: 'sent',
    createdAt: Date.now(),
    attachments: [],
  };
}

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

/** Event factories — keep StreamEvent literal types narrow. */
const ev = {
  content: (text: string): StreamEvent => ({ type: 'content', text }),
  toolCallStart: (index: number): StreamEvent => ({
    type: 'tool_call_start',
    index,
  }),
  toolCallDelta: (
    index: number,
    args: string,
    id = 'call-x',
    name = 'x',
  ): StreamEvent => ({
    type: 'tool_call_delta',
    index,
    id,
    name,
    argumentsDelta: args,
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

function makeParams(
  overrides: Partial<RunAgentLoopParams> = {},
): RunAgentLoopParams {
  return {
    sessionId: 'sess-1',
    userMessageId: 'assistant-msg-1',
    history: [makeUserMessage()],
    userContent: 'Hello',
    tools: [],
    adapter: createFakeAdapter([]),
    adapterConfig: TEST_ADAPTER_CONFIG,
    abortSignal: new AbortController().signal,
    onEvent: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent Loop E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegisteredTools();
    // Reset DB repo / MCP / confirmation mocks to safe defaults on every test.
    vi.mocked(listTools).mockReturnValue([]);
    vi.mocked(getToolsByName).mockReturnValue([]);
    vi.mocked(getAgentToolSafetyOverride).mockReturnValue('inherit');
    vi.mocked(mcpCallTool).mockReset();
    vi.mocked(listMcpTools).mockReset();
    vi.mocked(requestToolApproval).mockReset();
    vi.mocked(requestToolApproval).mockResolvedValue(true);
  });

  afterEach(() => {
    clearRegisteredTools();
    vi.restoreAllMocks();
  });

  // --- 1. Simple conversation (no tools) → Phase 1 regression -------------
  it('1. completes a tool-free conversation end-to-end (Phase 1 regression)', async () => {
    const adapter = createFakeAdapter([
      [ev.content('Hello!'), ev.content(' How are you?'), ev.finish('stop')],
    ]);
    const onEvent = vi.fn();

    const result = await runAgentLoop(makeParams({ adapter, onEvent }));

    expect(result.status).toBe('completed');
    expect(result.content).toBe('Hello! How are you?');

    const endEvent = onEvent.mock.calls
      .map(([e]: [AgentLoopEvent]) => e)
      .find((e) => e.type === 'agent_loop_end');
    expect(endEvent).toMatchObject({
      type: 'agent_loop_end',
      endReason: 'completed',
    });
  });

  // --- 2. LLM calls web_search → execute → continue → finish --------------
  it('2. runs a web_search tool call and continues to a final answer', async () => {
    const executeSpy = vi
      .fn<[Record<string, unknown>, { sessionId: string }]>()
      .mockResolvedValue({
        content: [
          { type: 'text', text: JSON.stringify({ hits: ['hello-world'] }) },
        ],
      });
    const webSearch: ToolExecutor = {
      execute: executeSpy,
      describe: () => ({
        ...makeTool('web_search'),
        description: 'Search the web',
      }),
    };
    registerTool('web_search', webSearch);

    const adapter = createFakeAdapter([
      // Iteration 1: model emits a tool call.
      [
        ev.content('Let me search for that.'),
        ev.toolCallStart(0),
        ev.toolCallDone(0, 'call-1', 'web_search', { query: 'hello' }),
        ev.finish('tool_calls'),
      ],
      // Iteration 2: model consumes the tool result and finishes.
      [ev.content('Found: hello-world'), ev.finish('stop')],
    ]);
    const onEvent = vi.fn();

    const result = await runAgentLoop(
      makeParams({
        adapter,
        onEvent,
        userContent: 'Search hello',
        tools: [makeTool('web_search')],
      }),
    );

    expect(result.status).toBe('completed');
    // fullContent accumulates across iterations, so check the suffix.
    expect(result.content).toContain('Found: hello-world');
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith(
      { query: 'hello' },
      expect.objectContaining({ sessionId: 'sess-1' }),
    );

    // tool_result event surfaced to the caller with the right callId.
    const toolResultEvent = onEvent.mock.calls
      .map(([e]: [AgentLoopEvent]) => e)
      .find((e) => e.type === 'tool_result');
    expect(toolResultEvent).toMatchObject({
      type: 'tool_result',
      toolResult: { callId: 'call-1', isError: false },
    });
  });

  // --- 3. Tool throws error → isError result → LLM continues --------------
  it('3. surfaces a tool exception as isError=true and lets the LLM recover', async () => {
    const crashy: ToolExecutor = {
      execute: vi.fn().mockRejectedValue(new Error('boom: upstream down')),
      describe: () => makeTool('crashy'),
    };
    registerTool('crashy', crashy);

    const adapter = createFakeAdapter([
      // Iteration 1: tool fails.
      [
        ev.toolCallDone(0, 'call-err', 'crashy', { x: 1 }),
        ev.finish('tool_calls'),
      ],
      // Iteration 2: LLM reads the error and finishes normally.
      [ev.content('Sorry, the tool failed.'), ev.finish('stop')],
    ]);
    const onEvent = vi.fn();

    const result = await runAgentLoop(
      makeParams({ adapter, onEvent, tools: [makeTool('crashy')] }),
    );

    expect(result.status).toBe('completed');
    expect(result.content).toBe('Sorry, the tool failed.');

    const toolResultEvent = onEvent.mock.calls
      .map(([e]: [AgentLoopEvent]) => e)
      .find((e) => e.type === 'tool_result') as
      | Extract<AgentLoopEvent, { type: 'tool_result' }>
      | undefined;
    expect(toolResultEvent).toBeDefined();
    expect(toolResultEvent?.toolResult.isError).toBe(true);
    expect(toolResultEvent?.toolResult.result).toContain('boom: upstream down');
  });

  // --- 4. Abort signal during tool execution ------------------------------
  it('4. aborts cleanly when the signal fires during tool execution', async () => {
    const ac = new AbortController();
    const slowTool: ToolExecutor = {
      execute: vi.fn().mockImplementation(async () => {
        // Simulate a user pressing "stop" mid-tool.
        ac.abort();
        return { content: [{ type: 'text', text: 'late-result' }] };
      }),
      describe: () => makeTool('slow'),
    };
    registerTool('slow', slowTool);

    const adapter = createFakeAdapter([
      [
        ev.toolCallDone(0, 'call-abort', 'slow'),
        ev.finish('tool_calls'),
      ],
    ]);

    const result = await runAgentLoop(
      makeParams({
        adapter,
        abortSignal: ac.signal,
        tools: [makeTool('slow')],
      }),
    );

    expect(result.status).toBe('aborted');
    // Per runner.ts: the post-tool-execution abort check fires the terminal
    // event with endReason 'aborted'.
  });

  // --- 5. maxIterations exceeded ------------------------------------------
  it('5. terminates with status=max_iterations when the model loops', async () => {
    const foreverTool: ToolExecutor = {
      execute: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'again' }],
      }),
      describe: () => makeTool('loopy'),
    };
    registerTool('loopy', foreverTool);

    // Every iteration returns a fresh tool call — model never stops.
    // 每次迭代的 arguments 必须不同：runner 的死循环去重按参数摘要跳过
    // 相同参数的重复调用（工具名不参与摘要）。
    const streams: StreamEvent[][] = Array.from({ length: 5 }, (_, i) => [
      ev.toolCallDone(0, `call-${i}`, 'loopy', { n: i }),
      ev.finish('tool_calls'),
    ]);
    const adapter = createFakeAdapter(streams);

    const result = await runAgentLoop(
      makeParams({
        adapter,
        tools: [makeTool('loopy')],
        maxIterations: 3,
      }),
    );

    expect(result.status).toBe('max_iterations');
    // Exactly `maxIterations` calls — no off-by-one extras.
    expect(foreverTool.execute).toHaveBeenCalledTimes(3);
  });

  // --- 6. Parallel tool_calls ---------------------------------------------
  it('6. executes parallel tool calls concurrently via Promise.all', async () => {
    let aStarted = false;
    let bStarted = false;
    let overlapped = false;

    const makeOverlappingExecutor = (label: string): ToolExecutor => ({
      execute: vi.fn().mockImplementation(async () => {
        if (label === 'a') aStarted = true;
        if (label === 'b') bStarted = true;
        // Wait a tick so both executors overlap.
        await new Promise((r) => setTimeout(r, 15));
        if (aStarted && bStarted) overlapped = true;
        return { content: [{ type: 'text', text: `${label}-out` }] };
      }),
      describe: () => makeTool(label),
    });

    registerTool('a', makeOverlappingExecutor('a'));
    registerTool('b', makeOverlappingExecutor('b'));

    const adapter = createFakeAdapter([
      // Iteration 1: two parallel tool calls.
      // 两个工具的 arguments 必须不同：runner 的去重摘要只覆盖参数
      // （不含工具名），相同参数会被误判为重复调用而跳过第二个。
      [
        ev.toolCallStart(0),
        ev.toolCallStart(1),
        ev.toolCallDone(0, 'call-a', 'a', { x: 'a' }),
        ev.toolCallDone(1, 'call-b', 'b', { x: 'b' }),
        ev.finish('tool_calls'),
      ],
      // Iteration 2: finish.
      [ev.finish('stop')],
    ]);
    const onEvent = vi.fn();

    const result = await runAgentLoop(
      makeParams({
        adapter,
        onEvent,
        tools: [makeTool('a'), makeTool('b')],
      }),
    );

    expect(result.status).toBe('completed');
    expect(overlapped).toBe(true);

    // Both tool_result events surfaced.
    const toolResults = onEvent.mock.calls
      .map(([e]: [AgentLoopEvent]) => e)
      .filter((e) => e.type === 'tool_result');
    expect(toolResults).toHaveLength(2);
  });

  // --- 7. High-risk confirmation (sync block) -----------------------------
  it('7. gates a high-danger DB tool on requestToolApproval and proceeds when approved', async () => {
    const highRiskTool: Tool = {
      id: 'db-nuke',
      name: 'nuke',
      description: 'High-risk op',
      inputSchema: { fields: [] },
      type: 'mcp-provided',
      safetyLevel: 'danger',
      sourceMcpId: 'mcp-1',
      policyVersion: 'test:nuke:v1',
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    };
    vi.mocked(getToolsByName).mockReturnValue([highRiskTool]);
    vi.mocked(requestToolApproval).mockResolvedValue(true);
    vi.mocked(mcpCallTool).mockResolvedValue({
      content: [{ type: 'text', text: 'nuke-fired-ok' }],
    });

    // Provide one enabled MCP so the executor can route after approval.
    const { listEnabledMcps } = await import('../../src/repo/mcp.js');
    vi.mocked(listEnabledMcps).mockReturnValue([
      {
        id: 'mcp-1',
        name: 'mc1',
        description: '',
        config: { transport: 'stdio' },
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
      },
    ]);

    const adapter = createFakeAdapter([
      [
        ev.toolCallDone(0, 'call-nuke-99', 'nuke', { target: 'x' }),
        ev.finish('tool_calls'),
      ],
      [ev.finish('stop')],
    ]);

    const result = await runAgentLoop(
      makeParams({ adapter, tools: [highRiskTool] }),
    );

    expect(result.status).toBe('completed');
    // Danger 工具被审批门控拦截一次，审批载荷携带 toolCallId / 安全等级 / 工具引用。
    expect(requestToolApproval).toHaveBeenCalledTimes(1);
    expect(requestToolApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        approval: expect.objectContaining({
          toolCallId: 'call-nuke-99',
          safetyLevel: 'danger',
          tool: expect.objectContaining({ name: 'nuke' }),
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    // After approval the executor routed to the MCP. The runner forwards the
    // abortSignal to the executor's context, which forwards it to mcpCallTool.
    expect(mcpCallTool).toHaveBeenCalledWith(
      'mcp-1',
      { transport: 'stdio' },
      'nuke',
      { target: 'x' },
      expect.any(AbortSignal),
    );
  });

  // --- 8. Skill injection into prompt -------------------------------------
  it('8. injects enabled skills into the system prompt sent to the LLM', async () => {
    const captured: { messages: ChatMessage[][] } = { messages: [] };
    const skillAdapter: ProviderAdapter = {
      type: 'openai',
      chatCompletionStream: (messages: ChatMessage[]) => {
        captured.messages.push(messages);
        return recordFromEvents([ev.finish('stop')]);
      },
    };

    await runAgentLoop(
      makeParams({
        adapter: skillAdapter,
        skills: [
          // 渐进披露（P2）：常规 skill 仅进清单；always skill 全文注入
          {
            name: 'code-review',
            description: '逐文件评审代码变更',
            body: 'Always check for edge cases.',
          },
          { name: 'persona', description: '', body: 'You are terse.', always: true },
        ],
      }),
    );

    expect(captured.messages.length).toBeGreaterThanOrEqual(1);
    const firstCall = captured.messages[0]!;

    // System prompt must contain the manifest entry (no body) + always full text.
    const systemContents = firstCall
      .filter((m) => m.role === 'system')
      .map((m) => m.content ?? '');
    const joined = systemContents.join('\n==\n');
    expect(joined).toContain('code-review');
    expect(joined).toContain('逐文件评审代码变更');
    expect(joined).toContain('read_skill');
    expect(joined).not.toContain('Always check for edge cases.');
    expect(joined).toContain('# Skill: persona');
    expect(joined).toContain('You are terse.');
  });
});
