/**
 * T27 Step B — End-to-End Integration QA
 *
 * Integration boundary:
 *   REAL    — runner.ts (runAgentLoop + runAgentLoopAsJob), worker.ts (processJob,
 *             start/stop, registerJobHandler), executor.ts, assembler.ts,
 *             truncator.ts, token-counter.ts, registry.ts
 *   MOCKED  — repo/message.ts, repo/tool.ts, repo/mcp.ts, mcp/manager.ts,
 *             tools/confirmation.ts (same as T18), repo/job.ts (job lifecycle),
 *             repo/summary.ts (summary persistence), prompt/summarizer.ts (LLM call)
 *
 * These tests verify the Step B features end-to-end:
 *   1. Async job mode dispatches an agent loop via the worker handler
 *   2. Job cancel / abort interrupts the handler cleanly
 *   3. Lazy history summarization triggers for long histories
 *   4. Token-budget truncation limits the messages sent to the LLM
 *   5. Summary + truncation + skill compose correctly in one assembly
 *   6. Stale job reclaim runs on worker startup
 *   7. Summarizer failure does not block the agent loop
 *   8. Sync and async entry points produce consistent results
 *
 * They are module-level integration tests (same level as T18), NOT HTTP E2E.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  Message,
  Tool,
  StreamEvent,
  Job,
  ToolCall,
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
  listEnabledTools: vi.fn(() => []),
}));

// 3. MCP DB repo — no enabled MCPs by default.
vi.mock('../../src/repo/mcp.js', () => ({
  listEnabledMcps: vi.fn(() => []),
}));

// 4. MCP manager — never spawns a real subprocess.
vi.mock('../../src/mcp/manager.js', () => ({
  callTool: vi.fn(),
}));

// 5. Confirmation store — default to approve.
vi.mock('../../src/tools/confirmation.js', () => ({
  waitForConfirmation: vi.fn().mockResolvedValue(true),
  resolveConfirmation: vi.fn(),
  getPendingConfirmation: vi.fn(),
  clearPendingConfirmations: vi.fn(),
}));

// 6. Job repo — full mock of every function the worker / tests touch.
//    Individual tests override return values via vi.mocked(...).mock...
vi.mock('../../src/repo/job.js', () => ({
  createJob: vi.fn(),
  getJob: vi.fn(),
  listJobs: vi.fn(() => []),
  listPendingJobs: vi.fn(() => []),
  listJobsBySession: vi.fn(() => []),
  claimJob: vi.fn(() => undefined),
  completeJob: vi.fn(() => undefined),
  failJob: vi.fn(() => undefined),
  cancelJob: vi.fn(() => undefined),
  reclaimStaleJobs: vi.fn(() => 0),
  renewJobLease: vi.fn(() => true),
  updateJobProgress: vi.fn(),
}));

// 7. Summary repo — no persisted summaries by default.
vi.mock('../../src/repo/summary.js', () => ({
  createSummary: vi.fn(),
  getLatestSummary: vi.fn(() => undefined),
  listSummariesBySession: vi.fn(() => []),
}));

// 8. Summarizer — default to "no summary produced" so the agent loop falls
//    back to plain truncation. Tests 3 & 7 override this per-test.
vi.mock('../../src/prompt/summarizer.js', () => ({
  summarizeHistory: vi.fn().mockResolvedValue(null),
}));

// Import AFTER mocks are registered. verbatimModuleSyntax requires `import type`
// for type-only imports.
import { runAgentLoop, runAgentLoopAsJob } from '../../src/agent-loop/runner.js';
import type {
  RunAgentLoopParams,
  AgentLoopEvent,
  AgentLoopJobContext,
} from '../../src/agent-loop/runner.js';
import {
  start,
  stop,
  processJob,
  registerJobHandler,
  clearJobHandlers,
} from '../../src/jobs/worker.js';
import { assembleMessages } from '../../src/prompt/assembler.js';
import type {
  ProviderAdapter,
  AdapterConfig,
  ChatMessage,
} from '../../src/llm/base.js';
import {
  registerTool,
  clearRegisteredTools,
  type ToolExecutor,
} from '../../src/tools/registry.js';
import { listTools } from '../../src/repo/tool.js';
import { callTool as mcpCallTool } from '../../src/mcp/manager.js';
import { waitForConfirmation } from '../../src/tools/confirmation.js';
import {
  claimJob,
  completeJob,
  failJob,
  reclaimStaleJobs,
  renewJobLease,
} from '../../src/repo/job.js';
import { createSummary, getLatestSummary } from '../../src/repo/summary.js';
import { summarizeHistory } from '../../src/prompt/summarizer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADAPTER_CONFIG: AdapterConfig = {
  baseUrl: 'http://localhost',
  apiKey: 'test-key',
  model: 'test-model',
};

function makeUserMessage(content = 'Hello', id = 'user-1'): Message {
  return {
    id,
    sessionId: 'sess-1',
    role: 'user',
    content,
    status: 'sent',
    createdAt: Date.now(),
    attachments: [],
  };
}

function makeAssistantMessage(content: string, id: string): Message {
  return {
    id,
    sessionId: 'sess-1',
    role: 'assistant',
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
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    type: 'agent-loop',
    payload: {},
    status: 'pending',
    priority: 0,
    attempts: 0,
    maxAttempts: 3,
    leasedAt: null,
    leaseOwner: null,
    error: null,
    result: null,
    sessionId: 'sess-1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/** Build an async generator from a fixed list of StreamEvent. */
function generatorFrom(
  events: StreamEvent[],
): AsyncGenerator<StreamEvent, void, unknown> {
  return (async function* () {
    for (const e of events) yield e;
  })();
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

/**
 * Build a mock adapter that returns the given event sequences in order.
 * Optionally captures the chatMessages handed to it for inspection.
 */
function makeAdapter(
  streams: StreamEvent[][],
  capture?: { messages: ChatMessage[][] },
): ProviderAdapter {
  let call = 0;
  return {
    type: 'openai',
    chatCompletionStream: (messages: ChatMessage[]) => {
      if (capture) capture.messages.push(messages);
      const events = streams[call];
      call += 1;
      if (!events) {
        return generatorFrom([ev.finish('stop')]);
      }
      return generatorFrom(events);
    },
  };
}

function makeRunnerParams(
  overrides: Partial<RunAgentLoopParams> = {},
): RunAgentLoopParams {
  return {
    sessionId: 'sess-1',
    userMessageId: 'assistant-msg-1',
    history: [makeUserMessage()],
    userContent: 'Hello',
    tools: [],
    adapter: makeAdapter([]),
    adapterConfig: ADAPTER_CONFIG,
    abortSignal: new AbortController().signal,
    onEvent: vi.fn(),
    ...overrides,
  };
}

/**
 * Build the AgentLoopJobContext expected by runAgentLoopAsJob.
 * Mirrors RunAgentLoopParams minus runtime bits (abortSignal, onEvent).
 */
function makeJobContext(
  overrides: Partial<AgentLoopJobContext> = {},
): AgentLoopJobContext {
  return {
    sessionId: 'sess-1',
    userMessageId: 'assistant-msg-1',
    history: [makeUserMessage()],
    userContent: 'Hello',
    tools: [],
    adapter: makeAdapter([]),
    adapterConfig: ADAPTER_CONFIG,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Step B E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegisteredTools();
    clearJobHandlers();
    // Reset DB repo / MCP / confirmation mocks to safe defaults on every test.
    vi.mocked(listTools).mockReturnValue([]);
    vi.mocked(mcpCallTool).mockReset();
    vi.mocked(waitForConfirmation).mockReset();
    vi.mocked(waitForConfirmation).mockResolvedValue(true);
    // Reset job repo mocks to safe defaults.
    vi.mocked(claimJob).mockReturnValue(undefined);
    vi.mocked(completeJob).mockReturnValue(undefined);
    vi.mocked(failJob).mockReturnValue(undefined);
    vi.mocked(reclaimStaleJobs).mockReturnValue(0);
    vi.mocked(renewJobLease).mockReturnValue(true);
    // Reset summary mocks.
    vi.mocked(createSummary).mockReset();
    vi.mocked(getLatestSummary).mockReturnValue(undefined);
    vi.mocked(summarizeHistory).mockResolvedValue(null);
  });

  afterEach(async () => {
    // Ensure no worker timers / handlers leak between tests.
    clearRegisteredTools();
    clearJobHandlers();
    await stop(500);
    vi.restoreAllMocks();
    // Clean up any env stubs from summary tests.
    delete process.env.CONTEXT_SUMMARIZE_THRESHOLD;
  });

  // --- 1. Async mode + tool chain — job handler dispatch --------------------
  it('1. dispatches an agent-loop job via the worker and persists the result', async () => {
    // Register a real built-in tool so the executor can route the call.
    const executeSpy = vi
      .fn<[Record<string, unknown>, { sessionId: string }]>()
      .mockResolvedValue({
        content: [{ type: 'text', text: 'echo-result' }],
      });
    const echoExecutor: ToolExecutor = {
      execute: executeSpy,
      describe: () => makeTool('echo'),
    };
    registerTool('echo', echoExecutor);

    // Build an adapter that emits a tool call then a final answer.
    const adapter = makeAdapter([
      [
        ev.content('Let me echo.'),
        ev.toolCallDone(0, 'call-1', 'echo', { text: 'hi' }),
        ev.finish('tool_calls'),
      ],
      [ev.content('Done: echo-result'), ev.finish('stop')],
    ]);

    // Build the job context that the agent-loop handler would receive.
    const context = makeJobContext({
      adapter,
      tools: [makeTool('echo')],
      userContent: 'echo hi',
    });
    const job = makeJob();

    // Register a custom agent-loop handler that mirrors the real worker
    // registration: it delegates to runAgentLoopAsJob with the context.
    registerJobHandler('agent-loop', async (j, signal) => {
      return runAgentLoopAsJob(j, context, signal);
    });

    // Drive a single job end-to-end through processJob (not the poll loop).
    await processJob(job);

    // The handler executed the tool exactly once with the right args.
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith(
      { text: 'hi' },
      expect.objectContaining({ sessionId: 'sess-1' }),
    );

    // completeJob captured the agent-loop result JSON.
    expect(completeJob).toHaveBeenCalledTimes(1);
    const [completedId, result] = vi.mocked(completeJob).mock.calls[0]!;
    expect(completedId).toBe('job-1');
    expect(result).toMatchObject({ status: 'completed' });
    expect(result.content).toContain('Done: echo-result');
    // Events array is collected and returned in the job result.
    expect(Array.isArray(result.events)).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);

    // No failure path triggered.
    expect(failJob).not.toHaveBeenCalled();
  });

  // --- 2. Job cancel / abort — handler respects the abort signal -----------
  it('2. aborts the in-flight job cleanly when the worker shuts down', async () => {
    // Handler waits for the abort signal, then reports it was cancelled.
    const handlerSpy = vi.fn();
    registerJobHandler('agent-loop', async (_job, signal) => {
      handlerSpy();
      // Block until the signal fires.
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      // Surface the abort as a terminal result so completeJob records it.
      return { status: 'cancelled', aborted: true };
    });

    const job = makeJob({ status: 'running' });

    // Kick off processJob without awaiting — it blocks inside the handler.
    const processPromise = processJob(job);

    // Give the handler a tick to register its abort listener.
    await new Promise((r) => setTimeout(r, 20));

    // Simulate a cancel by gracefully stopping the worker, which aborts the
    // in-flight job's internal AbortController.
    await stop(2_000);

    // processJob resolves once the handler returns + completeJob runs.
    await processPromise;

    expect(handlerSpy).toHaveBeenCalledTimes(1);
    // Handler observed the abort and returned a cancelled result, which the
    // worker persisted via completeJob.
    expect(completeJob).toHaveBeenCalledTimes(1);
    const [, result] = vi.mocked(completeJob).mock.calls[0]!;
    expect(result).toMatchObject({ status: 'cancelled' });
  });

  // --- 3. Summary triggered for long history -------------------------------
  it('3. invokes the summarizer and persists a summary when history is long', async () => {
    // Force the threshold low so a modest history triggers summarization.
    process.env.CONTEXT_SUMMARIZE_THRESHOLD = '10';

    // Build 6 user/assistant turns — enough to clear MIN_MESSAGES_TO_SUMMARIZE
    // (5) and the token threshold (10).
    const history: Message[] = [];
    for (let i = 0; i < 6; i++) {
      const role = i % 2 === 0 ? 'user' : 'assistant';
      history.push({
        id: `msg-${i}`,
        sessionId: 'sess-1',
        role,
        content: `This is message ${i} with some meaningful content.`,
        status: 'sent',
        createdAt: Date.now() + i,
        attachments: [],
      });
    }

    // Mock summarizer returns a real summary so createSummary is invoked.
    vi.mocked(summarizeHistory).mockResolvedValue({
      summary: 'Conversation about messages 0-5.',
      tokenCount: 80,
    });

    const adapter = makeAdapter([[ev.content('ok'), ev.finish('stop')]]);

    await runAgentLoop(
      makeRunnerParams({
        history,
        adapter,
        userContent: 'next',
      }),
    );

    // The lazy summarizer was called with the unsummarized tail.
    expect(summarizeHistory).toHaveBeenCalledTimes(1);
    const summaryCall = vi.mocked(summarizeHistory).mock.calls[0]!;
    expect(summaryCall[0].messages.length).toBeGreaterThanOrEqual(5);

    // The summary was persisted via the repo.
    expect(createSummary).toHaveBeenCalledTimes(1);
    const [createParams] = vi.mocked(createSummary).mock.calls[0]!;
    expect(createParams.sessionId).toBe('sess-1');
    expect(createParams.summary).toContain('messages 0-5');
    expect(createParams.summarizedUpToMessageId).toBe('msg-5');
  });

  // --- 4. Truncation limits messages sent to the LLM -----------------------
  it('4. truncates history to the token budget and preserves tool chains', () => {
    // Token math (per T26 learnings):
    //   - 'x'.repeat(3200) ≈ 804 tokens (800 content + 4 role overhead)
    //   - tool content 'z'.repeat(4800) ≈ 1204 tokens + empty assistant (4)
    // Fixture: 4 large user msgs + 2 tool chains (asst+tool) = 8 messages.
    // With maxTokens=4000 → historyBudget=2000 (after SYSTEM_RESERVE=2000).
    // Walking newest→oldest keeps only the newest tool chain [a1,t1].
    const bigUser = 'x'.repeat(3200);
    const bigTool = 'z'.repeat(4800);

    const tc1: ToolCall = { id: 'tc-1', name: 'echo', arguments: '{}' };
    const tc2: ToolCall = { id: 'tc-2', name: 'echo', arguments: '{}' };

    const history: Message[] = [
      {
        id: 'h-0',
        sessionId: 'sess-1',
        role: 'user',
        content: bigUser,
        status: 'sent',
        createdAt: 0,
        attachments: [],
      },
      {
        id: 'h-1',
        sessionId: 'sess-1',
        role: 'user',
        content: bigUser,
        status: 'sent',
        createdAt: 1,
        attachments: [],
      },
      {
        id: 'h-2',
        sessionId: 'sess-1',
        role: 'user',
        content: bigUser,
        status: 'sent',
        createdAt: 2,
        attachments: [],
      },
      {
        id: 'h-3',
        sessionId: 'sess-1',
        role: 'user',
        content: bigUser,
        status: 'sent',
        createdAt: 3,
        attachments: [],
      },
      {
        id: 'h-4',
        sessionId: 'sess-1',
        role: 'assistant',
        content: '',
        toolCalls: [tc1],
        status: 'sent',
        createdAt: 4,
        attachments: [],
      },
      {
        id: 'h-5',
        sessionId: 'sess-1',
        role: 'tool',
        content: bigTool,
        toolCallId: 'tc-1',
        status: 'sent',
        createdAt: 5,
        attachments: [],
      },
      {
        id: 'h-6',
        sessionId: 'sess-1',
        role: 'assistant',
        content: '',
        toolCalls: [tc2],
        status: 'sent',
        createdAt: 6,
        attachments: [],
      },
      {
        id: 'h-7',
        sessionId: 'sess-1',
        role: 'tool',
        content: bigTool,
        toolCallId: 'tc-2',
        status: 'sent',
        createdAt: 7,
        attachments: [],
      },
    ];

    const assembled = assembleMessages({
      history,
      userContent: 'next',
      maxTokens: 4000,
    });

    // Truncation dropped messages: fewer than the 8 input history messages
    // (plus the current user message).
    const historyOut = assembled.filter((m) => m.role !== 'system');
    expect(historyOut.length).toBeLessThan(history.length + 1);

    // Tool-chain integrity: every surviving tool message must reference a
    // toolCallId that belongs to a surviving assistant message. No orphans.
    const toolMessages = assembled.filter((m) => m.role === 'tool');
    const assistantToolCallIds = new Set(
      assembled
        .filter((m) => m.role === 'assistant' && m.toolCalls)
        .flatMap((m) => m.toolCalls!.map((tc) => tc.id)),
    );
    for (const tm of toolMessages) {
      expect(tm.toolCallId).toBeDefined();
      expect(assistantToolCallIds.has(tm.toolCallId!)).toBe(true);
    }

    // At least one tool chain survived (the newest one, [a1,t1]).
    expect(toolMessages.length).toBeGreaterThanOrEqual(1);
    expect(assistantToolCallIds.has('tc-2')).toBe(true);
  });

  // --- 5. Summary + truncation + skill combined ----------------------------
  it('5. composes default prompt + skills + summary + truncated history in one assembly', () => {
    const bigBody = 'y'.repeat(3200);
    const history: Message[] = [];
    for (let i = 0; i < 6; i++) {
      history.push({
        id: `hist-${i}`,
        sessionId: 'sess-1',
        role: 'user',
        content: bigBody,
        status: 'sent',
        createdAt: i,
        attachments: [],
      });
    }

    const assembled = assembleMessages({
      history,
      userContent: 'continue',
      skills: [
        { name: 'code-review', body: 'Always check for edge cases.' },
        { name: 'testing', body: 'Prefer integration tests.' },
      ],
      summary: { text: 'Prior turns discussed the architecture.' },
      maxTokens: 4500,
    });

    // System messages: default + skills + summary (exactly 3).
    const systemMessages = assembled.filter((m) => m.role === 'system');
    expect(systemMessages).toHaveLength(3);

    const systemText = systemMessages.map((m) => m.content ?? '').join('\n==\n');
    // Default Chinese instruction.
    expect(systemText).toContain('AI 助手');
    // Both skills injected.
    expect(systemText).toContain('code-review');
    expect(systemText).toContain('Always check for edge cases.');
    expect(systemText).toContain('testing');
    expect(systemText).toContain('Prefer integration tests.');
    // Summary injected as the third system message.
    expect(systemText).toContain('Previous conversation summary');
    expect(systemText).toContain('Prior turns discussed the architecture.');

    // History was truncated: 6 input history messages, fewer survive.
    const nonSystemCount = assembled.filter((m) => m.role !== 'system').length;
    expect(nonSystemCount).toBeLessThan(history.length + 1);

    // The current user message is always appended last.
    const last = assembled[assembled.length - 1]!;
    expect(last.role).toBe('user');
    expect(last.content).toContain('continue');
  });

  // --- 6. Stale job reclaim on worker startup -------------------------------
  it('6. reclaims stale jobs when the worker starts up', async () => {
    // Mock the repo to report 3 stale jobs reclaimed.
    vi.mocked(reclaimStaleJobs).mockReturnValue(3);

    // Also ensure claimJob returns nothing so the poll loop stays idle.
    vi.mocked(claimJob).mockReturnValue(undefined);

    await start();

    // start() invokes reclaimStaleJobs once with the stale-lease window.
    expect(reclaimStaleJobs).toHaveBeenCalledTimes(1);
    const [leaseTimeoutMs] = vi.mocked(reclaimStaleJobs).mock.calls[0]!;
    // The worker uses a 2-minute stale lease window by default.
    expect(leaseTimeoutMs).toBeGreaterThan(0);
    expect(typeof leaseTimeoutMs).toBe('number');

    // Poll loop scheduled a claim attempt and saw nothing to do.
    expect(claimJob).toHaveBeenCalled();
  });

  // --- 7. Summary failure does not block the agent loop --------------------
  it('7. continues normally when the summarizer fails or returns null', async () => {
    // Force summarization to be attempted.
    process.env.CONTEXT_SUMMARIZE_THRESHOLD = '10';

    const history: Message[] = [];
    for (let i = 0; i < 6; i++) {
      const role = i % 2 === 0 ? 'user' : 'assistant';
      history.push({
        id: `msg-${i}`,
        sessionId: 'sess-1',
        role,
        content: `Message ${i} body content here.`,
        status: 'sent',
        createdAt: Date.now() + i,
        attachments: [],
      });
    }

    // Case A: summarizer throws — runner must swallow and continue.
    vi.mocked(summarizeHistory).mockRejectedValue(new Error('LLM down'));

    const adapterA = makeAdapter([[ev.content('all good'), ev.finish('stop')]]);
    const resultA = await runAgentLoop(
      makeRunnerParams({ history: [...history], adapter: adapterA }),
    );

    expect(resultA.status).toBe('completed');
    expect(resultA.content).toBe('all good');
    // No summary persisted because the call failed.
    expect(createSummary).not.toHaveBeenCalled();

    // Case B: summarizer returns null (no summary produced) — also non-fatal.
    vi.mocked(summarizeHistory).mockResolvedValue(null);

    const adapterB = makeAdapter([[ev.content('still ok'), ev.finish('stop')]]);
    const resultB = await runAgentLoop(
      makeRunnerParams({ history: [...history], adapter: adapterB }),
    );

    expect(resultB.status).toBe('completed');
    expect(resultB.content).toBe('still ok');
    expect(createSummary).not.toHaveBeenCalled();
  });

  // --- 8. Sync / async mode data consistency -------------------------------
  it('8. produces consistent results between sync runAgentLoop and runAgentLoopAsJob', async () => {
    const history: Message[] = [
      makeUserMessage('What is 2+2?', 'u-1'),
      makeAssistantMessage('4', 'a-1'),
    ];

    // Sync path: runAgentLoop forwards events through onEvent.
    const syncEvents: AgentLoopEvent[] = [];
    const syncAdapter = makeAdapter([
      [ev.content('The answer is 4.'), ev.finish('stop')],
    ]);
    const syncResult = await runAgentLoop(
      makeRunnerParams({
        history: [...history],
        adapter: syncAdapter,
        userContent: 'confirm',
        onEvent: (e) => {
          syncEvents.push(e);
        },
      }),
    );

    // Async path: runAgentLoopAsJob collects events into the result.
    const asyncAdapter = makeAdapter([
      [ev.content('The answer is 4.'), ev.finish('stop')],
    ]);
    const context = makeJobContext({
      history: [...history],
      adapter: asyncAdapter,
      userContent: 'confirm',
    });
    const jobResult = await runAgentLoopAsJob(
      makeJob(),
      context,
      new AbortController().signal,
    );

    // Both paths report the same terminal status and content.
    expect(syncResult.status).toBe('completed');
    expect(jobResult.status).toBe('completed');
    expect(jobResult.content).toBe(syncResult.content);

    // The async job result carries the collected events array.
    expect(Array.isArray(jobResult.events)).toBe(true);
    expect(jobResult.events.length).toBe(syncEvents.length);

    // The terminal event endReason matches across modes.
    const syncEnd = syncEvents.find((e) => e.type === 'agent_loop_end');
    const asyncEnd = (jobResult.events as AgentLoopEvent[]).find(
      (e) => e.type === 'agent_loop_end',
    );
    expect(syncEnd).toBeDefined();
    expect(asyncEnd).toBeDefined();
    expect(asyncEnd).toMatchObject({ type: 'agent_loop_end' });
    if (syncEnd?.type === 'agent_loop_end' && asyncEnd?.type === 'agent_loop_end') {
      expect(asyncEnd.endReason).toBe(syncEnd.endReason);
    }
  });
});
