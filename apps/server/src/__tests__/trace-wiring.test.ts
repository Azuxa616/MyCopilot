import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Context } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Message,
  Model,
  Provider,
  StreamEvent,
  Tool,
} from '@my-copilot/shared';

// ---------------------------------------------------------------------------
// Trace 采集接线集成测试（同步 / 异步两条生产链路）。
//
// 与单元测试的区别：这里走真实的 streamMessageHandler → runAgentLoop →
// repo/runTrace 落库链路，仅 mock 两个进程外边界：
//   - llm/index.js getAdapter —— 换成脚本化 FakeAdapter（不打真实 LLM）
//   - hono/streaming streamSSE —— 驱动 SSE 回调（SSE 写出不是本测试对象）
// 断言核心语义：runs.user_message_id 必须是真实用户消息 id（lifecycle
// createMessage 的返回值），绝不是 assistant 占位 id。
// ---------------------------------------------------------------------------

const mockGetAdapter = vi.fn();

vi.mock('../llm/index.js', () => ({
  getAdapter: (...args: unknown[]) => mockGetAdapter(...args),
}));

let streamRunPromise: Promise<void> | null = null;
const mockStream = {
  writeSSE: vi.fn(async () => {}),
  onAbort: vi.fn(() => {}),
};

vi.mock('hono/streaming', () => ({
  streamSSE: (
    _c: unknown,
    cb: (stream: typeof mockStream) => Promise<void>,
  ) => {
    streamRunPromise = cb(mockStream);
    return new Response(null, { status: 200 });
  },
}));

import { streamMessageHandler } from '../streaming/lifecycle.js';
import { processJob, registerAgentLoopHandler } from '../jobs/worker.js';
import { createFakeAdapter, TEST_ADAPTER_CONFIG } from '../llm/testing/fake-adapter.js';
import { initDatabase, getDb } from '../db/index.js';
import { createSession } from '../repo/session.js';
import { listMessagesBySession } from '../repo/message.js';
import { createJob, getJob, claimJob } from '../repo/job.js';
import {
  createSqliteTraceCollector,
  listRunsBySession,
  getRunWithSteps,
} from '../repo/runTrace.js';
import {
  registerTool,
  clearRegisteredTools,
  type ToolExecutor,
} from '../tools/registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOOL_NAME = 'trace_echo';

function makeTool(): Tool {
  return {
    id: `tool-${TOOL_NAME}`,
    name: TOOL_NAME,
    description: 'trace wiring test tool',
    inputSchema: { fields: [] },
    type: 'built-in',
    safetyLevel: 'safe',
    sourceMcpId: null,
    policyVersion: `test:${TOOL_NAME}:v1`,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

const traceEchoExecutor: ToolExecutor = {
  execute: async () => ({ content: [{ type: 'text', text: 'echo-ok' }] }),
  describe: () => makeTool(),
};

const provider: Provider = {
  id: 'prov-1',
  name: 'test',
  type: 'openai',
  baseUrl: 'http://localhost',
  apiKey: 'key',
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
};

const model: Model = {
  id: 'model-1',
  providerId: 'prov-1',
  name: 'test-model',
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
};

function makeUserMessage(content: string): Message {
  return {
    id: 'client-user-msg',
    sessionId: 'pending',
    role: 'user',
    content,
    attachments: [],
    status: 'sent',
    createdAt: Date.now(),
  };
}

const ev = {
  content: (text: string): StreamEvent => ({ type: 'content', text }),
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

/** 两轮脚本：第一轮工具调用，第二轮文本收尾。 */
const TWO_ROUND_SCRIPT = [
  [ev.toolCallDone(0, 'call-1', TOOL_NAME, { x: 1 }), ev.finish('tool_calls')],
  [ev.content('done'), ev.finish('stop')],
];

interface AgentLoopPayloadShape {
  sessionId: string;
  userMessageId: string;
  realUserMessageId?: string;
  userContent: string;
  history: Message[];
  attachments?: Array<{ name: string; content: string }>;
  adapterType: 'openai' | 'ollama';
  adapterConfig: { baseUrl: string; apiKey?: string; model: string };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('trace 采集接线（同步 / 异步生产链路 → runs 表）', () => {
  let testDir: string;
  let sessionId: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-trace-'));
    initDatabase(testDir);
    sessionId = createSession({}).id;
    registerTool(TOOL_NAME, traceEchoExecutor);
    mockGetAdapter.mockReset();
    mockGetAdapter.mockReturnValue(createFakeAdapter(TWO_ROUND_SCRIPT));
    streamRunPromise = null;
    delete process.env.AGENT_ASYNC_MODE;
  });

  afterEach(() => {
    delete process.env.AGENT_ASYNC_MODE;
    clearRegisteredTools();
    try {
      getDb().close();
    } catch {
      // ignore
    }
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('同步链路：runs.user_message_id = 真实用户消息 id（非 assistant 占位 id）', async () => {
    const response = streamMessageHandler({} as unknown as Context, {
      sessionId,
      userMessage: makeUserMessage('跑一次同步轨迹'),
      provider,
      model,
      history: [],
    });
    expect(response.status).toBe(200);
    await streamRunPromise;

    const messages = listMessagesBySession(sessionId);
    const userMsg = messages.find((m) => m.role === 'user');
    // assistant 占位消息 = 无 toolCalls 的那条（工具轮的 assistant 带 toolCalls）。
    const placeholder = messages.find(
      (m) => m.role === 'assistant' && m.toolCalls === undefined,
    );
    expect(userMsg).toBeDefined();
    expect(placeholder).toBeDefined();

    const runs = listRunsBySession(sessionId);
    expect(runs).toHaveLength(1);
    const run = runs[0]!;

    // 核心语义断言：真实用户消息 id，而非占位 id。
    expect(run.userMessageId).toBe(userMsg!.id);
    expect(run.userMessageId).not.toBe(placeholder!.id);
    expect(run.assistantMessageId).toBe(placeholder!.id);
    expect(run.jobId).toBeNull();

    // 采集完整性：终态字段 + 步骤计数（llm_call ×2 + tool_exec ×1）。
    expect(run.status).toBe('completed');
    expect(run.stopReason).toBe('end_turn');
    expect(run.iterations).toBe(2);
    const detail = getRunWithSteps(run.id)!;
    expect(detail.steps.map((s) => s.type)).toEqual([
      'llm_call',
      'tool_exec',
      'llm_call',
    ]);
    const toolStep = detail.steps[1]!;
    expect(toolStep.toolName).toBe(TOOL_NAME);
    expect(toolStep.argsPreview).toBe('{"x":1}');
  });

  it('异步链路：worker 从 payload.realUserMessageId 采集，user_message_id 仍为真实 id', async () => {
    process.env.AGENT_ASYNC_MODE = 'true';
    registerAgentLoopHandler();

    const jsonSpy = vi.fn();
    streamMessageHandler(
      { json: jsonSpy } as unknown as Context,
      {
        sessionId,
        userMessage: makeUserMessage('跑一次异步轨迹'),
        provider,
        model,
        history: [],
      },
    );

    // 入队响应里的 jobId + payload 带上了刚创建的真实用户消息 id。
    const responseBody = jsonSpy.mock.calls[0]![0] as {
      data: { jobId: string };
    };
    const jobId = responseBody.data.jobId;
    const job = getJob(jobId)!;
    const payload = job.payload as unknown as AgentLoopPayloadShape;
    const messages = listMessagesBySession(sessionId);
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(payload.realUserMessageId).toBe(userMsg!.id);
    expect(payload.userMessageId).not.toBe(userMsg!.id);

    // 真实 worker 流程：claim（pending → running）→ processJob。
    const claimed = claimJob('worker-test')!;
    expect(claimed.id).toBe(jobId);
    await processJob(claimed);

    // job 完成且采集落库：user_message_id 真实、jobId 关联、终态完整。
    expect(getJob(jobId)!.status).toBe('done');
    const runs = listRunsBySession(sessionId);
    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    expect(run.userMessageId).toBe(userMsg!.id);
    expect(run.userMessageId).not.toBe(payload.userMessageId);
    expect(run.jobId).toBe(jobId);
    expect(run.status).toBe('completed');
    expect(run.stopReason).toBe('end_turn');
    const detail = getRunWithSteps(run.id)!;
    expect(detail.steps.filter((s) => s.type === 'tool_exec')).toHaveLength(1);
  });

  it('异步链路（旧 payload）：缺 realUserMessageId 时 warn 并跳过采集，loop 照常完成', async () => {
    registerAgentLoopHandler();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 手工构造旧版 payload（无 realUserMessageId）入队，走真实 claim 流程。
    const created = createJob({
      type: 'agent-loop',
      payload: {
        sessionId,
        userMessageId: 'legacy-placeholder-assistant-id',
        userContent: '旧版负载',
        history: [],
        attachments: [],
        adapterType: 'openai',
        adapterConfig: TEST_ADAPTER_CONFIG,
      },
      sessionId,
      maxAttempts: 1,
    });
    const claimed = claimJob('worker-test')!;
    expect(claimed.id).toBe(created.id);

    try {
      await processJob(claimed);

      // loop 正常完成，但该 Run 不落 runs 行。
      expect(getJob(created.id)!.status).toBe('done');
      expect(listRunsBySession(sessionId)).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalled();
      expect(
        warnSpy.mock.calls.some(([msg]) =>
          String(msg).includes('realUserMessageId'),
        ),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('createSqliteTraceCollector：落库异常（FK 违反）被吞掉并 console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 不存在的 session → runs.session_id 外键约束触发 INSERT 失败。
      const collector = createSqliteTraceCollector({
        sessionId: 'no-such-session',
        userMessageId: 'um-1',
      });
      expect(() =>
        collector.onRunStart({ status: 'in_progress' }),
      ).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
      // 后续 onStep / onRunEnd 在 run 未创建时安全跳过。
      expect(() =>
        collector.onStep({
          id: 's1',
          runId: 'r1',
          seq: 1,
          type: 'llm_call',
          toolName: null,
          argsPreview: null,
          resultPreview: null,
          isError: false,
          durationMs: 5,
          createdAt: new Date().toISOString(),
        }),
      ).not.toThrow();
      expect(() =>
        collector.onRunEnd({ status: 'completed', stopReason: 'end_turn' }),
      ).not.toThrow();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
