import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Job,
  Message,
  RunContext,
  StreamEvent,
  Tool,
  ToolApproval,
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
import type {
  setJobWaitingForConfirmation,
  resumeJobAfterConfirmation,
} from '../../repo/job.js';
import type { AssembleV2Params } from '../../prompt/assembler.js';

// ---------------------------------------------------------------------------
// Agent Loop v2 + Context v2 端到端集成测试（T15）
//
// 与 runner.test.ts（单元级）的区别：这里验证的是重写后的 runner 与全部
// v2 组件的「真实集成」——runner 本体、run-state（Run 状态机）、loop-guard
// （循环防护 + 重复调用 digest）、stop-router（路由表）全部走真实实现，
// 只在 adapter / repo / executor 这类 I/O 边界上打 mock：
//
//   - repo/message.js   —— 持久化边界（createMessage/updateMessage）
//   - tools/executor.js —— 工具执行边界（executeToolCall，含确认回调）
//   - prompt/assembler.js —— 默认委托真实 assembleMessagesV2（端到端装配），
//     场景 D 用 mockImplementationOnce 覆盖返回值以隔离测试 Context v2 的
//     消费端（降级不阻断 runner）
//   - repo/memory.js    —— Memory 注入的 SQLite 读取
//   - repo/job.js       —— 异步 job 模式的确认联动 SQL（setJobWaiting… /
//     resumeJob…），mock 后可断言 runAgentLoopAsJob 的联动行为
//
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
    assembleMessagesV2: (
      ...args: Parameters<typeof actual.assembleMessagesV2>
    ) => mockAssembleMessagesV2(...args),
  };
});

vi.mock('../../repo/memory.js', () => ({
  // assembleMessagesV2 的 Memory 注入（sessionId 存在时）会读取 SQLite；
  // 测试环境返回空列表以避免触碰真实数据库。
  listMemories: vi.fn(() => []),
}));

const mockSetJobWaitingForConfirmation = vi.fn<
  (id: string, approval: Record<string, unknown>) => unknown
>();
const mockResumeJobAfterConfirmation = vi.fn<(id: string) => unknown>();

vi.mock('../../repo/job.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../repo/job.js')>();
  return {
    ...actual,
    setJobWaitingForConfirmation: (
      ...args: Parameters<typeof setJobWaitingForConfirmation>
    ) => mockSetJobWaitingForConfirmation(...args),
    resumeJobAfterConfirmation: (
      ...args: Parameters<typeof resumeJobAfterConfirmation>
    ) => mockResumeJobAfterConfirmation(...args),
  };
});

import {
  runAgentLoop,
  runAgentLoopAsJob,
} from '../runner.js';
import type {
  RunAgentLoopParams,
  AgentLoopEvent,
  AgentLoopJobContext,
} from '../runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(name = 'calc'): Tool {
  return {
    id: `tool-${name}`,
    name,
    description: `integration test tool ${name}`,
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

function toolResult(text: string, isError = false): ToolExecutionResult {
  return { content: [{ type: 'text', text }], isError };
}

function makeParams(
  overrides: Partial<RunAgentLoopParams> = {},
): RunAgentLoopParams {
  return {
    sessionId: 'sess-int',
    userMessageId: 'assistant-int-1',
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
  toolCallDelta: (
    index: number,
    id: string,
    name: string,
    argsDelta: string,
  ): StreamEvent => ({
    type: 'tool_call_delta',
    index,
    id,
    name,
    argumentsDelta: argsDelta,
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

/**
 * 把 onEvent 收到的事件序列压缩为「场景断言用的标签」：
 * llm_event 细化为 `llm:<stream 事件类型>`，其余事件保留 AgentLoopEvent
 * 的 type（终态事件细化为 `end:<endReason>`）。
 */
function labelEvents(calls: Array<[AgentLoopEvent]>): string[] {
  return calls.map(([e]) => {
    if (e.type === 'llm_event') return `llm:${e.event.type}`;
    if (e.type === 'agent_loop_end') return `end:${e.endReason}`;
    return e.type;
  });
}

/**
 * 场景 C 用：先吐出 events，然后挂起（模拟长流不结束）。signal abort 时
 * 以异常退出——对齐真实 adapter（fetch signal abort → 流抛 AbortError）。
 *
 * `parked` 在全部事件被消费、流即将挂起时 resolve，让测试可以确定性地
 * 在「内容已产出、流仍在飞行中」的时机触发 abort（不依赖计时器）。
 */
function hangingStream(signal: AbortSignal, eventsToYield: StreamEvent[]) {
  let parked!: () => void;
  const parkedPromise = new Promise<void>((resolve) => {
    parked = resolve;
  });
  const gen = (async function* () {
    for (const e of eventsToYield) yield e;
    // 消费方已收到全部事件，下一次 pull 即挂起。
    parked();
    await new Promise<never>((_, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new Error('simulated upstream abort')),
        { once: true },
      );
    });
  })();
  return { gen, parked: parkedPromise };
}

/** 场景 B 用：一份完整的 ToolApproval（pending 态）。 */
function makeApproval(overrides: Partial<ToolApproval> = {}): ToolApproval {
  return {
    approvalId: 'approval-1',
    runId: 'job-1',
    jobId: 'job-1',
    sessionId: 'sess-job',
    agentId: 'default',
    tool: {
      id: 'tool-calc',
      name: 'calc',
      source: 'built-in',
      sourceMcpId: null,
      policyVersion: 'test:calc:v1',
    },
    toolCallId: 'call-c',
    arguments: '{"x":1}',
    argumentsDigest: 'digest-1',
    resourceScope: 'calc:{x:1}',
    safetyLevel: 'restricted',
    policyVersion: 'test:calc:v1',
    state: 'pending',
    expiresAt: Date.now() + 60_000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agent loop v2 + context v2 集成（runner 真实编排）', () => {
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

  // ---------------------------------------------------------------------
  // 场景 A：同步模式全链路（happy path）
  // ---------------------------------------------------------------------
  it('场景 A：sync 模式下 content → tool_call → tool_result → content → completed 的完整链路', async () => {
    const adapter = makeAdapter([
      // 第一轮：先说话，再请求工具
      generatorFrom([
        events.content('你好'),
        events.toolCallStart(0),
        events.toolCallDelta(0, 'call-1', 'calc', '{"x"'),
        events.toolCallDone(0, 'call-1', 'calc', { x: 1 }),
        events.finish('tool_calls'),
      ]),
      // 第二轮：消费工具结果后给出最终回复
      generatorFrom([events.content('结果'), events.finish('stop')]),
    ]);
    mockExecuteToolCall.mockResolvedValue(toolResult('42'));
    const onEvent = vi.fn<(event: AgentLoopEvent) => void>();

    const result = await runAgentLoop(
      makeParams({ adapter, onEvent, tools: [makeTool('calc')] }),
    );

    // 终态 + 最终内容
    expect(result.status).toBe('completed');
    expect(result.content).toContain('结果');

    // 事件序列（按发生顺序）：首轮 content → tool_call_done → tool_result
    // → 次轮 content → agent_loop_end('completed')
    const labels = labelEvents(
      onEvent.mock.calls as unknown as Array<[AgentLoopEvent]>,
    );
    const relevant = labels.filter((l) =>
      [
        'llm:content',
        'llm:tool_call_done',
        'tool_result',
        'end:completed',
      ].includes(l),
    );
    expect(relevant).toEqual([
      'llm:content', // 第一轮 content('你好')
      'llm:tool_call_done', // 第一轮工具调用完成
      'tool_result', // 真实执行结果回传
      'llm:content', // 第二轮 content('结果')
      'end:completed', // 终态事件
    ]);

    // 真实并行路径执行了一次工具（Promise.all 分支）
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    expect(mockExecuteToolCall).toHaveBeenCalledWith(
      { id: 'call-1', name: 'calc', arguments: '{"x":1}' },
      expect.objectContaining({
        sessionId: 'sess-int',
        advertisedTool: expect.objectContaining({ name: 'calc' }),
      }),
    );

    // assistant（带 toolCalls）+ tool 消息被持久化
    const assistantPersist = mockCreateMessage.mock.calls.find(
      ([p]: [CreateMessageParams]) => p.role === 'assistant',
    )?.[0];
    expect(assistantPersist).toMatchObject({
      sessionId: 'sess-int',
      role: 'assistant',
      content: '你好',
      status: 'sent',
    });
    expect(assistantPersist?.toolCalls).toEqual([
      { id: 'call-1', name: 'calc', arguments: '{"x":1}' },
    ]);

    const toolPersist = mockCreateMessage.mock.calls.find(
      ([p]: [CreateMessageParams]) => p.role === 'tool',
    )?.[0];
    expect(toolPersist).toMatchObject({
      role: 'tool',
      toolCallId: 'call-1',
      status: 'sent',
    });
    expect(toolPersist?.content).toContain('42');

    // 占位 assistant 消息收到最终内容 + sent 状态
    expect(mockUpdateMessage).toHaveBeenCalledWith('assistant-int-1', {
      content: '结果',
      status: 'sent',
    });
  });

  // ---------------------------------------------------------------------
  // 场景 B：异步 job 模式 + 确认流联动
  // ---------------------------------------------------------------------
  it('场景 B：runAgentLoopAsJob 收集事件数组并联动确认流（waiting ↔ resume）', async () => {
    const adapter = makeAdapter([
      generatorFrom([
        events.toolCallDone(0, 'call-c', 'calc', { x: 1 }),
        events.finish('tool_calls'),
      ]),
      generatorFrom([events.content('job-done'), events.finish('stop')]),
    ]);

    // mock 工具执行：触发「需要确认 → 已批准」回调，然后返回结果。
    // runner 侧会把这两个回调接入真实 Run 状态机
    // （in_progress → requires_action → in_progress）。
    mockExecuteToolCall.mockImplementation(
      async (
        _tc: unknown,
        ctx: {
          onConfirmationRequired?: (a: ToolApproval) => void;
          onConfirmationSettled?: (a: ToolApproval) => void;
        },
      ) => {
        const pending = makeApproval();
        ctx.onConfirmationRequired?.(pending);
        ctx.onConfirmationSettled?.(
          makeApproval({ state: 'approved' }),
        );
        return toolResult('confirmed-out');
      },
    );

    // Job 对象形状对齐 jobs/worker.ts:244-281 的 handler 透传方式
    const job: Job = {
      id: 'job-1',
      type: 'agent-loop',
      payload: {},
      status: 'running',
      priority: 0,
      attempts: 1,
      maxAttempts: 1,
      leasedAt: Date.now(),
      leaseOwner: 'worker-test',
      error: null,
      result: null,
      sessionId: 'sess-job',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const context: AgentLoopJobContext = {
      sessionId: 'sess-job',
      userMessageId: 'assistant-job-1',
      history: [],
      userContent: 'hello job',
      tools: [makeTool('calc')],
      adapter,
      adapterConfig,
    };

    const result = await runAgentLoopAsJob(
      job,
      context,
      new AbortController().signal,
    );

    // 返回值含 status + content + events 数组
    expect(result.status).toBe('completed');
    expect(result.content).toBe('job-done');
    expect(Array.isArray(result.events)).toBe(true);

    const collected = result.events as AgentLoopEvent[];
    const collectedLabels = collected.map((e) => {
      if (e.type === 'llm_event') return `llm:${e.event.type}`;
      if (e.type === 'agent_loop_end') return `end:${e.endReason}`;
      return e.type;
    });

    // 事件按序收集：确认请求 → 确认落定 → 工具结果 → 终态。
    // （Run 状态机若出现非法转移会直接抛错，status 就不会是 completed——
    // 这里同时验证了 requires_action ↔ in_progress 的往返合法性。）
    const relevant = collectedLabels.filter((l) =>
      [
        'tool_confirmation_required',
        'tool_confirmation_settled',
        'tool_result',
        'end:completed',
      ].includes(l),
    );
    expect(relevant).toEqual([
      'tool_confirmation_required',
      'tool_confirmation_settled',
      'tool_result',
      'end:completed',
    ]);

    // 第二轮 LLM 的 content 也被收进 events
    expect(
      collected.some(
        (e) =>
          e.type === 'llm_event' &&
          e.event.type === 'content' &&
          (e.event as { text?: string }).text === 'job-done',
      ),
    ).toBe(true);

    // job 联动：waiting_confirmation 写入 pendingApproval，确认后 resume。
    expect(mockSetJobWaitingForConfirmation).toHaveBeenCalledTimes(1);
    expect(mockSetJobWaitingForConfirmation).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        approvalId: 'approval-1',
        toolCallId: 'call-c',
        state: 'pending',
        safetyLevel: 'restricted',
      }),
    );
    expect(mockResumeJobAfterConfirmation).toHaveBeenCalledTimes(1);
    expect(mockResumeJobAfterConfirmation).toHaveBeenCalledWith('job-1');

    // job 模式下持久化照常发生（占位消息终态 + assistant/tool 消息）
    expect(mockUpdateMessage).toHaveBeenCalledWith('assistant-job-1', {
      content: 'job-done',
      status: 'sent',
    });
    const jobRoles = mockCreateMessage.mock.calls.map(
      ([p]: [CreateMessageParams]) => p.role,
    );
    expect(jobRoles).toContain('assistant');
    expect(jobRoles).toContain('tool');
  });

  // ---------------------------------------------------------------------
  // 场景 C：外部 abort（流挂起时中断，无计时器依赖）
  // ---------------------------------------------------------------------
  it('场景 C：流挂起时外部 abort → status aborted + 持久化 aborted + 终态事件', async () => {
    const ac = new AbortController();
    const { gen, parked } = hangingStream(ac.signal, [
      events.content('partial'),
    ]);
    const adapter: ProviderAdapter = {
      type: 'openai',
      chatCompletionStream: () => gen,
    };
    const onEvent = vi.fn<(event: AgentLoopEvent) => void>();

    const runPromise = runAgentLoop(
      makeParams({ adapter, abortSignal: ac.signal, onEvent }),
    );

    // 确定性等待：content 已被消费、流正在挂起时才触发 abort（微任务序，
    // 不依赖 setTimeout / 真实计时）。
    await parked;
    ac.abort();

    const result = await runPromise;

    expect(result.status).toBe('aborted');
    // catch 路径：中断发生在迭代完成前，lastIterationContent 仍为空串。
    expect(mockUpdateMessage).toHaveBeenCalledWith('assistant-int-1', {
      content: '',
      status: 'aborted',
    });
    // 终态事件发出（safeEmit 吞掉回调异常，但事件本身必须到达 onEvent）
    const endLabels = labelEvents(
      onEvent.mock.calls as unknown as Array<[AgentLoopEvent]>,
    ).filter((l) => l.startsWith('end:'));
    expect(endLabels).toEqual(['end:aborted']);
    // 流被中断，工具从未执行
    expect(mockExecuteToolCall).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // 场景 D：Context v2 装配降级（degraded=true 不阻断 runner）
  // ---------------------------------------------------------------------
  it('场景 D：装配返回 degraded RunContext 时 runner 正常完成并输出降级 debug 日志', async () => {
    // 长 history（触发降级的真实输入形态；返回值由 mock 覆盖以隔离测试
    // Context v2 的消费端，不构造真实超长 token 数据）。
    const history: Message[] = Array.from({ length: 24 }, (_, i) => ({
      id: `h-${i}`,
      sessionId: 'sess-degraded',
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `历史消息 ${i} `.repeat(20),
      status: 'sent' as const,
      createdAt: 1_000 + i,
      attachments: [],
    }));

    // 覆盖装配返回值：降级 + 截短后的 messages。
    const degradedContext: RunContext = {
      messages: [
        { role: 'system', content: 'sys-short' },
        { role: 'user', content: 'hello' },
      ],
      budget: {
        system: 1,
        tools: 2,
        history: 7,
        toolOutputs: 3,
        working: 4,
        headroom: 5,
        total: 22,
      },
      degraded: true,
    };
    mockAssembleMessagesV2.mockImplementationOnce(async () => degradedContext);

    const streamCalls: unknown[] = [];
    const adapter: ProviderAdapter = {
      type: 'openai',
      chatCompletionStream: (messages) => {
        streamCalls.push(messages);
        return generatorFrom([events.content('ok'), events.finish('stop')]);
      },
    };

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const result = await runAgentLoop(
        makeParams({ adapter, history }),
      );

      // 降级不阻断：runner 正常完成
      expect(result.status).toBe('completed');
      expect(result.content).toBe('ok');

      // 降级 debug 日志（含预算信息）
      expect(debugSpy).toHaveBeenCalledTimes(1);
      const debugLine = String(debugSpy.mock.calls[0]![0]);
      expect(debugLine).toMatch(/降级/);
      expect(debugLine).toContain('7'); // budget.history
      expect(debugLine).toContain('22'); // budget.total

      // runner 消费的是降级后的 RunContext.messages（截短直通 adapter）
      expect(mockAssembleMessagesV2).toHaveBeenCalledTimes(1);
      expect(mockAssembleMessagesV2.mock.calls[0]![0].history).toHaveLength(24);
      expect(streamCalls[0]).toEqual(degradedContext.messages);
    } finally {
      debugSpy.mockRestore();
    }
  });
});
