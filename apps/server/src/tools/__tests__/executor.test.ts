import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mcp, SafetyLevel, Tool, ToolCall } from '@my-copilot/shared';

// --- Mocks ---------------------------------------------------------------
// The executor pulls from five external surfaces: the in-memory registry
// (this module), the tool DB repo (getToolsByName), the agent safety
// override repo, the MCP DB repo, the MCP manager (callTool + listTools),
// and the confirmation store (approval-based, session-cached). We mock
// each so the executor's routing logic can be unit-tested in isolation.

vi.mock('../../repo/tool.js', () => ({
  listTools: vi.fn(() => []),
  getToolsByName: vi.fn(() => []),
}));

vi.mock('../../repo/agent.js', () => ({
  getAgentToolSafetyOverride: vi.fn(() => 'inherit'),
}));

vi.mock('../../repo/mcp.js', () => ({
  listEnabledMcps: vi.fn(() => []),
}));

vi.mock('../../mcp/manager.js', () => ({
  callTool: vi.fn(),
  listTools: vi.fn(),
}));

vi.mock('../confirmation.js', () => ({
  isConfirmedThisSession: vi.fn(() => false),
  markConfirmedThisSession: vi.fn(),
  requestToolApproval: vi.fn(),
}));

import { executeToolCall } from '../executor.js';
import { getToolsByName } from '../../repo/tool.js';
import { getAgentToolSafetyOverride } from '../../repo/agent.js';
import { listEnabledMcps } from '../../repo/mcp.js';
import { callTool as mcpCallTool, listTools as listMcpTools } from '../../mcp/manager.js';
import { requestToolApproval } from '../confirmation.js';
import {
  registerTool,
  clearRegisteredTools,
  type ToolExecutor,
  type ToolExecutionContext,
} from '../registry.js';

// --- Helpers -------------------------------------------------------------

const CTX: ToolExecutionContext = {
  sessionId: 'sess-1',
  onConfirmationRequired: vi.fn(),
  onConfirmationSettled: vi.fn(),
};

function makeToolCall(name: string, args: unknown = {}, id = 'call-1'): ToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

function makeDbTool(
  name: string,
  overrides: Partial<Tool> = {},
): Tool {
  return {
    id: `db-${name}`,
    name,
    description: '',
    inputSchema: { fields: [] },
    type: 'mcp-provided',
    safetyLevel: 'restricted',
    sourceMcpId: null,
    policyVersion: `test:${name}:v1`,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeMcp(id: string): Mcp {
  return {
    id,
    name: `mc-${id}`,
    description: '',
    config: { transport: 'stdio' },
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

function builtinExecutor(
  result: { content: Array<{ type: 'text'; text: string }>; isError?: boolean },
  name: string,
  safetyLevel: SafetyLevel = 'safe',
): ToolExecutor {
  return {
    execute: vi.fn().mockResolvedValue(result),
    describe: () =>
      makeDbTool(name, { type: 'built-in', safetyLevel, sourceMcpId: null }),
  };
}

describe('executeToolCall routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegisteredTools();
    vi.mocked(getToolsByName).mockReturnValue([]);
    vi.mocked(getAgentToolSafetyOverride).mockReturnValue('inherit');
    vi.mocked(listEnabledMcps).mockReturnValue([]);
    vi.mocked(mcpCallTool).mockReset();
    vi.mocked(listMcpTools).mockReset();
    vi.mocked(requestToolApproval).mockReset();
    vi.mocked(requestToolApproval).mockResolvedValue(true);
  });

  // --- 1. Built-in path -------------------------------------------------
  it('routes to a registered built-in executor and returns its result', async () => {
    const exec = builtinExecutor({ content: [{ type: 'text', text: 'hello' }] }, 'greet');
    registerTool('greet', exec);

    const result = await executeToolCall(makeToolCall('greet', { who: 'world' }), CTX);

    expect(result).toEqual({ content: [{ type: 'text', text: 'hello' }] });
    expect(exec.execute).toHaveBeenCalledWith({ who: 'world' }, CTX);
    // The DB is consulted first (name lookup precedes the registry); MCP must
    // not be touched for a built-in hit.
    expect(getToolsByName).toHaveBeenCalledWith('greet');
    expect(mcpCallTool).not.toHaveBeenCalled();
  });

  // --- 2. Unknown tool --------------------------------------------------
  it('returns isError "Unknown tool" when nothing matches', async () => {
    vi.mocked(getToolsByName).mockReturnValue([]);
    vi.mocked(listEnabledMcps).mockReturnValue([]);

    const result = await executeToolCall(makeToolCall('nope'), CTX);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Unknown tool');
  });

  // --- 3. Built-in that throws → caught --------------------------------
  it('catches a built-in executor exception and returns isError', async () => {
    const exec = builtinExecutor({ content: [] }, 'crash');
    vi.mocked(exec.execute).mockRejectedValue(new Error('boom'));
    registerTool('crash', exec);

    const result = await executeToolCall(makeToolCall('crash'), CTX);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('boom');
  });

  // --- 4. DB tool, safe → no confirmation -------------------------------
  it('executes a safe DB built-in tool without confirmation', async () => {
    const exec = builtinExecutor({ content: [{ type: 'text', text: 'result' }] }, 'safe_lookup');
    registerTool('safe_lookup', exec);
    vi.mocked(getToolsByName).mockReturnValue([
      makeDbTool('safe_lookup', { type: 'built-in', safetyLevel: 'safe' }),
    ]);

    const result = await executeToolCall(makeToolCall('safe_lookup', { q: 'x' }), CTX);

    // 'safe' never gates on confirmation — the session cache is not even
    // consulted.
    expect(requestToolApproval).not.toHaveBeenCalled();
    expect(exec.execute).toHaveBeenCalledWith({ q: 'x' }, CTX);
    expect(mcpCallTool).not.toHaveBeenCalled();
    expect(result).toEqual({ content: [{ type: 'text', text: 'result' }] });
  });

  // --- 5. DB tool, danger → gated on requestToolApproval -----------------
  it('blocks a danger DB mcp-provided tool on requestToolApproval', async () => {
    vi.mocked(getToolsByName).mockReturnValue([
      makeDbTool('nuke', { safetyLevel: 'danger', sourceMcpId: 'mcp-1' }),
    ]);
    vi.mocked(listEnabledMcps).mockReturnValue([makeMcp('mcp-1')]);
    vi.mocked(mcpCallTool).mockResolvedValue({ content: [{ type: 'text', text: 'done' }] });

    const result = await executeToolCall(
      makeToolCall('nuke', {}, 'tool-id-99'),
      CTX,
    );

    expect(requestToolApproval).toHaveBeenCalledTimes(1);
    // 审批请求携带 toolCallId、安全等级与工具引用
    expect(requestToolApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        approval: expect.objectContaining({
          toolCallId: 'tool-id-99',
          safetyLevel: 'danger',
          tool: expect.objectContaining({ name: 'nuke' }),
        }),
        signal: undefined,
        onRequired: CTX.onConfirmationRequired,
      }),
    );
    // After approval the call proceeds to the MCP route.
    expect(mcpCallTool).toHaveBeenCalledWith(
      'mcp-1',
      { transport: 'stdio' },
      'nuke',
      {},
      undefined,
    );
    expect(result).toEqual({ content: [{ type: 'text', text: 'done' }] });
  });

  // --- 6. DB danger + user rejects → "rejected or expired" ---------------
  it('returns "rejected or expired" when the approval resolves to false', async () => {
    vi.mocked(getToolsByName).mockReturnValue([
      makeDbTool('danger', { safetyLevel: 'danger', sourceMcpId: 'mcp-1' }),
    ]);
    vi.mocked(listEnabledMcps).mockReturnValue([makeMcp('mcp-1')]);
    vi.mocked(requestToolApproval).mockResolvedValue(false);

    const result = await executeToolCall(makeToolCall('danger'), CTX);

    expect(requestToolApproval).toHaveBeenCalled();
    expect(mcpCallTool).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Tool execution was rejected or expired');
  });

  // --- 7. Restricted already confirmed this session → no re-gate ---------
  it('does not gate a restricted DB tool already confirmed this session', async () => {
    vi.mocked(getToolsByName).mockReturnValue([
      makeDbTool('careful', { safetyLevel: 'restricted', sourceMcpId: 'mcp-1' }),
    ]);
    vi.mocked(listEnabledMcps).mockReturnValue([makeMcp('mcp-1')]);
    vi.mocked(mcpCallTool).mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const { isConfirmedThisSession } = await import('../confirmation.js');
    vi.mocked(isConfirmedThisSession).mockReturnValue(true);

    await executeToolCall(makeToolCall('careful'), CTX);

    expect(requestToolApproval).not.toHaveBeenCalled();
    expect(mcpCallTool).toHaveBeenCalledWith(
      'mcp-1',
      { transport: 'stdio' },
      'careful',
      {},
      undefined,
    );
  });

  // --- 8. JSON parse error in arguments → caught ------------------------
  it('catches invalid JSON arguments and returns isError', async () => {
    const exec = builtinExecutor({ content: [{ type: 'text', text: 'x' }] }, 'parseme');
    registerTool('parseme', exec);

    const result = await executeToolCall(
      { id: 'c', name: 'parseme', arguments: '{not valid json' },
      CTX,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text.length).toBeGreaterThan(0);
    expect(exec.execute).not.toHaveBeenCalled();
  });

  // --- 9. MCP fallback for tools not in DB ------------------------------
  it('falls back to the dynamic MCP route for a tool that is not in the DB', async () => {
    vi.mocked(getToolsByName).mockReturnValue([]); // no DB match
    vi.mocked(listEnabledMcps).mockReturnValue([makeMcp('mcp-7')]);
    // 动态路由会先在启用的 MCP 上 listTools 找到工具名（返回完整 Tool 形状）
    vi.mocked(listMcpTools).mockResolvedValue([
      makeDbTool('dynamic_tool', { sourceMcpId: 'mcp-7' }),
    ]);
    vi.mocked(mcpCallTool).mockResolvedValue({ content: [{ type: 'text', text: 'dyn' }] });
    // 动态工具默认 restricted：靠会话内已确认缓存跳过审批
    const { isConfirmedThisSession } = await import('../confirmation.js');
    vi.mocked(isConfirmedThisSession).mockReturnValue(true);

    const result = await executeToolCall(makeToolCall('dynamic_tool'), CTX);

    expect(listMcpTools).toHaveBeenCalledWith('mcp-7', { transport: 'stdio' });
    expect(mcpCallTool).toHaveBeenCalledWith(
      'mcp-7',
      { transport: 'stdio' },
      'dynamic_tool',
      {},
      undefined,
    );
    expect(result).toEqual({ content: [{ type: 'text', text: 'dyn' }] });
  });

  // --- 10. DB built-in type without an executor → graceful error -------
  it('returns "no executor" for a DB built-in type without a registered executor', async () => {
    vi.mocked(getToolsByName).mockReturnValue([
      makeDbTool('orphan', { type: 'built-in', safetyLevel: 'safe' }),
    ]);

    const result = await executeToolCall(makeToolCall('orphan'), CTX);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('No executor registered');
    expect(mcpCallTool).not.toHaveBeenCalled();
  });

  // --- 11. mcp-provided DB tool whose source MCP is disabled -----------
  it('returns a friendly error when the source MCP server is not enabled', async () => {
    vi.mocked(getToolsByName).mockReturnValue([
      makeDbTool('remote_only', { sourceMcpId: 'mcp-gone' }),
    ]);
    vi.mocked(listEnabledMcps).mockReturnValue([]); // none enabled

    const result = await executeToolCall(makeToolCall('remote_only'), CTX);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('MCP source "mcp-gone" is not enabled');
  });

  // --- 12. Dynamic MCP route finds the tool on no server → unknown -----
  it('returns "Unknown tool" when the fallback MCP route also fails on every server', async () => {
    vi.mocked(getToolsByName).mockReturnValue([]);
    vi.mocked(listEnabledMcps).mockReturnValue([makeMcp('mcp-err')]);
    // 每个 MCP 的 listTools 都失败 → 无匹配 → "Unknown tool"
    vi.mocked(listMcpTools).mockRejectedValue(new Error('tool not found'));

    const result = await executeToolCall(makeToolCall('ghost'), CTX);

    // The fallback block swallows the per-server MCP errors and falls through
    // to the "Unknown tool" return.
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Unknown tool');
    expect(mcpCallTool).not.toHaveBeenCalled();
  });

  // --- 13. 确认缓存粒度回归（context7 死循环 + 重复询问 bug）-------------
  // 用真实 Set 模拟 sessionConfirmations 缓存，验证 executor 传入的 cacheKey：
  // 同一 restricted 工具的不同参数必须映射到同一个 key（一次确认全会话免问）。
  async function mockSessionCache(): Promise<Set<string>> {
    const confirmed = new Set<string>();
    const { isConfirmedThisSession, markConfirmedThisSession } =
      await import('../confirmation.js');
    vi.mocked(isConfirmedThisSession).mockImplementation((key) => confirmed.has(key));
    vi.mocked(markConfirmedThisSession).mockImplementation((key) => {
      confirmed.add(key);
    });
    return confirmed;
  }

  it('回归：restricted 工具同会话不同参数不再重复询问（参数摘要不进 cacheKey）', async () => {
    await mockSessionCache();
    vi.mocked(getToolsByName).mockReturnValue([
      makeDbTool('resolve-library-id', { safetyLevel: 'restricted', sourceMcpId: 'mcp-1' }),
    ]);
    vi.mocked(listEnabledMcps).mockReturnValue([makeMcp('mcp-1')]);
    vi.mocked(mcpCallTool).mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

    // 第一次：未确认 → 请求审批 → 批准 → 写入会话缓存
    await executeToolCall(
      makeToolCall('resolve-library-id', { libraryName: 'React' }, 'call-1'),
      CTX,
    );
    expect(requestToolApproval).toHaveBeenCalledTimes(1);

    // 第二次：同工具、不同参数 → 缓存命中 → 直接执行，不再弹确认框
    await executeToolCall(
      makeToolCall('resolve-library-id', { libraryName: 'Vue.js' }, 'call-2'),
      CTX,
    );
    expect(requestToolApproval).toHaveBeenCalledTimes(1);
    expect(mcpCallTool).toHaveBeenCalledTimes(2);
  });

  it('path 参数工具保留按路径的确认粒度：不同路径仍需确认、同路径免确认', async () => {
    await mockSessionCache();
    vi.mocked(getToolsByName).mockReturnValue([
      makeDbTool('file_edit', { safetyLevel: 'restricted', sourceMcpId: 'mcp-1' }),
    ]);
    vi.mocked(listEnabledMcps).mockReturnValue([makeMcp('mcp-1')]);
    vi.mocked(mcpCallTool).mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

    await executeToolCall(
      makeToolCall('file_edit', { path: 'C:\\tmp\\a.txt' }, 'call-1'),
      CTX,
    );
    await executeToolCall(
      makeToolCall('file_edit', { path: 'C:\\tmp\\b.txt' }, 'call-2'),
      CTX,
    );
    expect(requestToolApproval).toHaveBeenCalledTimes(2);

    // 同一路径 → 命中缓存
    await executeToolCall(
      makeToolCall('file_edit', { path: 'C:\\tmp\\a.txt' }, 'call-3'),
      CTX,
    );
    expect(requestToolApproval).toHaveBeenCalledTimes(2);
  });

  it('url 参数工具按 origin 粒度缓存：同 origin 不同路径免确认、跨 origin 重新确认', async () => {
    await mockSessionCache();
    vi.mocked(getToolsByName).mockReturnValue([
      makeDbTool('web_fetch', { safetyLevel: 'restricted', sourceMcpId: 'mcp-1' }),
    ]);
    vi.mocked(listEnabledMcps).mockReturnValue([makeMcp('mcp-1')]);
    vi.mocked(mcpCallTool).mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

    await executeToolCall(makeToolCall('web_fetch', { url: 'https://a.com/x' }, 'call-1'), CTX);
    await executeToolCall(makeToolCall('web_fetch', { url: 'https://a.com/y' }, 'call-2'), CTX);
    expect(requestToolApproval).toHaveBeenCalledTimes(1);

    await executeToolCall(makeToolCall('web_fetch', { url: 'https://b.com/x' }, 'call-3'), CTX);
    expect(requestToolApproval).toHaveBeenCalledTimes(2);
  });
});
