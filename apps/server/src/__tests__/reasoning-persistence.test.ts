import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '@my-copilot/shared';

// ---------------------------------------------------------------------------
// reasoning 持久化集成测试（计划 todo 13 Manual-QA）。
//
// 与单元测试的区别：走真实 initDatabase + 真实 repo/message 落库链路，
// 仅以 FakeProviderAdapter 注入脚本化 reasoning 事件流（不打真实 LLM）。
// 断言核心数据形状：messages 表 reasoning 列值 = 该轮 reasoning 增量的
// 拼接全文（直查 SQL，不经 repo 映射）。
// ---------------------------------------------------------------------------

import { runAgentLoop } from '../agent-loop/runner.js';
import { createFakeAdapter, TEST_ADAPTER_CONFIG } from '../llm/testing/fake-adapter.js';
import { initDatabase, getDb } from '../db/index.js';
import { createSession } from '../repo/session.js';
import { createMessage } from '../repo/message.js';
import {
  registerTool,
  clearRegisteredTools,
  type ToolExecutor,
} from '../tools/registry.js';

const TOOL_NAME = 'reasoning_echo';

function makeTool(): Tool {
  return {
    id: `tool-${TOOL_NAME}`,
    name: TOOL_NAME,
    description: 'reasoning persistence test tool',
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

const echoExecutor: ToolExecutor = {
  execute: async () => ({ content: [{ type: 'text', text: 'echo-ok' }] }),
  describe: () => makeTool(),
};

interface MessageRowShape {
  id: string;
  role: string;
  content: string;
  reasoning: string | null;
  status: string;
}

function selectMessages(sessionId: string): MessageRowShape[] {
  return getDb()
    .prepare(
      'SELECT id, role, content, reasoning, status FROM messages WHERE session_id = ? ORDER BY created_at ASC',
    )
    .all(sessionId) as MessageRowShape[];
}

describe('reasoning 持久化（真库集成）', () => {
  let testDir: string;
  let sessionId: string;
  let placeholderId: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-reasoning-'));
    initDatabase(testDir);
    sessionId = createSession({}).id;
    // 生产链路中占位 assistant 消息由 lifecycle 创建（userMessageId 装其 id）。
    const placeholder = createMessage({
      sessionId,
      role: 'assistant',
      content: '',
      status: 'sending',
    });
    placeholderId = placeholder.id;
    registerTool(TOOL_NAME, echoExecutor);
  });

  afterEach(() => {
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

  it('单轮：reasoning 列 = 增量拼接全文，content 不含推理文本', async () => {
    const adapter = createFakeAdapter([
      [
        { type: 'reasoning', text: '用户问的是简单加法，' },
        { type: 'reasoning', text: '2+3=5，' },
        { type: 'reasoning', text: '直接回答' },
        { type: 'content', text: '答案是 5' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);

    const result = await runAgentLoop({
      sessionId,
      userMessageId: placeholderId,
      history: [],
      userContent: '2+3 等于几？',
      tools: [],
      adapter,
      adapterConfig: TEST_ADAPTER_CONFIG,
      abortSignal: new AbortController().signal,
      onEvent: vi.fn(),
    });

    expect(result.status).toBe('completed');

    const rows = selectMessages(sessionId);
    const placeholder = rows.find((r) => r.id === placeholderId)!;
    expect(placeholder.role).toBe('assistant');
    expect(placeholder.reasoning).toBe('用户问的是简单加法，2+3=5，直接回答');
    expect(placeholder.content).toBe('答案是 5');
    expect(placeholder.status).toBe('sent');
  });

  it('多轮：工具轮 assistant 消息与终轮占位消息各带本轮 reasoning', async () => {
    const adapter = createFakeAdapter([
      [
        { type: 'reasoning', text: '第一轮：需要计算器' },
        { type: 'tool_call_start', index: 0 },
        { type: 'tool_call_done', index: 0, id: 'call-1', name: TOOL_NAME, arguments: '{}' },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [
        { type: 'reasoning', text: '第二轮：拿到结果，' },
        { type: 'reasoning', text: '组织回答' },
        { type: 'content', text: '结果是 echo-ok' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);

    const result = await runAgentLoop({
      sessionId,
      userMessageId: placeholderId,
      history: [],
      userContent: '跑一次带推理的工具轮',
      tools: [makeTool()],
      adapter,
      adapterConfig: TEST_ADAPTER_CONFIG,
      abortSignal: new AbortController().signal,
      onEvent: vi.fn(),
    });

    expect(result.status).toBe('completed');

    const rows = selectMessages(sessionId);
    const toolRound = rows.find((r) => r.role === 'assistant' && r.id !== placeholderId)!;
    expect(toolRound.reasoning).toBe('第一轮：需要计算器');

    const placeholder = rows.find((r) => r.id === placeholderId)!;
    expect(placeholder.reasoning).toBe('第二轮：拿到结果，组织回答');
  });

  it('无 reasoning 事件时列保持 NULL（旧行为回归）', async () => {
    const adapter = createFakeAdapter([
      [
        { type: 'content', text: '直答' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);

    await runAgentLoop({
      sessionId,
      userMessageId: placeholderId,
      history: [],
      userContent: '直接回答',
      tools: [],
      adapter,
      adapterConfig: TEST_ADAPTER_CONFIG,
      abortSignal: new AbortController().signal,
      onEvent: vi.fn(),
    });

    const placeholder = selectMessages(sessionId).find((r) => r.id === placeholderId)!;
    expect(placeholder.reasoning).toBeNull();
    expect(placeholder.content).toBe('直答');
  });
});
