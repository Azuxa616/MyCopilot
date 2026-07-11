import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Tool, ToolCall } from '@my-copilot/shared';

// --- Mocks ---------------------------------------------------------------
// The executor pulls from four external surfaces: the in-memory registry
// (this module), the tool DB repo, the MCP DB repo, the MCP manager, and
// the confirmation store. We mock each so the executor's routing logic can
// be unit-tested in isolation.

vi.mock('../../repo/tool.js', () => ({
  listTools: vi.fn(() => []),
}));

vi.mock('../../repo/mcp.js', () => ({
  listEnabledMcps: vi.fn(() => []),
}));

vi.mock('../../mcp/manager.js', () => ({
  callTool: vi.fn(),
}));

vi.mock('../confirmation.js', () => ({
  waitForConfirmation: vi.fn(),
}));

import { executeToolCall } from '../executor.js';
import { listTools } from '../../repo/tool.js';
import { listEnabledMcps } from '../../repo/mcp.js';
import { callTool as mcpCallTool } from '../../mcp/manager.js';
import { waitForConfirmation } from '../confirmation.js';
import {
  registerTool,
  clearRegisteredTools,
  type ToolExecutor,
} from '../registry.js';

// --- Helpers -------------------------------------------------------------

const CTX = { sessionId: 'sess-1' };

function makeToolCall(name: string, args: unknown = {}, id = 'call-1'): ToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

function builtinExecutor(
  result: { content: Array<{ type: 'text'; text: string }>; isError?: boolean },
  describe?: Partial<Tool>,
): ToolExecutor {
  return {
    execute: vi.fn().mockResolvedValue(result),
    describe: () =>
      ({
        id: 'builtin',
        name: 'x',
        description: '',
        inputSchema: { fields: [] },
        type: 'built-in',
        safetyLevel: 'safe',
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
        ...describe,
      }) as Tool,
  };
}

describe('executeToolCall routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegisteredTools();
    vi.mocked(listTools).mockReturnValue([]);
    vi.mocked(listEnabledMcps).mockReturnValue([]);
    vi.mocked(mcpCallTool).mockReset();
    vi.mocked(waitForConfirmation).mockReset();
  });

  // --- 1. Built-in path -------------------------------------------------
  it('routes to a registered built-in executor and returns its result', async () => {
    const exec = builtinExecutor({ content: [{ type: 'text', text: 'hello' }] });
    registerTool('greet', exec);

    const result = await executeToolCall(makeToolCall('greet', { who: 'world' }), CTX);

    expect(result).toEqual({ content: [{ type: 'text', text: 'hello' }] });
    expect(exec.execute).toHaveBeenCalledWith({ who: 'world' }, CTX);
    // DB / MCP must not be consulted for a built-in hit.
    expect(listTools).not.toHaveBeenCalled();
    expect(mcpCallTool).not.toHaveBeenCalled();
  });

  // --- 2. Unknown tool --------------------------------------------------
  it('returns isError "Unknown tool" when nothing matches', async () => {
    vi.mocked(listTools).mockReturnValue([]);
    vi.mocked(listEnabledMcps).mockReturnValue([]);

    const result = await executeToolCall(makeToolCall('nope'), CTX);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Unknown tool');
  });

  // --- 3. Built-in that throws → caught --------------------------------
  it('catches a built-in executor exception and returns isError', async () => {
    const exec: ToolExecutor = {
      execute: vi.fn().mockRejectedValue(new Error('boom')),
      describe: () => ({}) as Tool,
    };
    registerTool('crash', exec);

    const result = await executeToolCall(makeToolCall('crash'), CTX);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('boom');
  });

  // --- 4. DB tool, low danger → no confirmation -------------------------
  it('executes a low-danger DB mcp-provided tool without confirmation', async () => {
    const lowDangerTool: Tool = {
      id: 'db-1',
      name: 'safe_lookup',
      description: '',
      inputSchema: { fields: [] },
      type: 'mcp-provided',
      safetyLevel: 'safe',
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    };
    vi.mocked(listTools).mockReturnValue([lowDangerTool]);
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
    vi.mocked(mcpCallTool).mockResolvedValue({
      content: [{ type: 'text', text: 'result' }],
    });

    const result = await executeToolCall(makeToolCall('safe_lookup', { q: 'x' }), CTX);

    expect(waitForConfirmation).not.toHaveBeenCalled();
    expect(mcpCallTool).toHaveBeenCalledWith(
      'mcp-1',
      { transport: 'stdio' },
      'safe_lookup',
      { q: 'x' },
      undefined,
    );
    expect(result).toEqual({
      content: [{ type: 'text', text: 'result' }],
    });
  });

  // --- 5. DB tool, high danger → blocked on confirmation ----------------
  it('blocks a high-danger DB tool on waitForConfirmation', async () => {
    const highDangerTool: Tool = {
      id: 'db-2',
      name: 'nuke',
      description: '',
      inputSchema: { fields: [] },
      type: 'mcp-provided',
      safetyLevel: 'danger',
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    };
    vi.mocked(listTools).mockReturnValue([highDangerTool]);
    vi.mocked(waitForConfirmation).mockResolvedValue(true);
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
    vi.mocked(mcpCallTool).mockResolvedValue({ content: [{ type: 'text', text: 'done' }] });

    const result = await executeToolCall(
      makeToolCall('nuke', {}, 'tool-id-99'),
      CTX,
    );

    expect(waitForConfirmation).toHaveBeenCalledTimes(1);
    // callId must be namespaced by sessionId.
    expect(waitForConfirmation).toHaveBeenCalledWith(
      'sess-1:tool-id-99',
      expect.objectContaining({ name: 'nuke' }),
      300_000,
    );
    // After approval the call proceeds to the MCP route.
    expect(mcpCallTool).toHaveBeenCalled();
    expect(result).toEqual({ content: [{ type: 'text', text: 'done' }] });
  });

  // --- 6. DB high-danger + user rejects → "rejected" -------------------
  it('returns "rejected by user" when confirmation resolves to false', async () => {
    const highDangerTool: Tool = {
      id: 'db-3',
      name: 'danger',
      description: '',
      inputSchema: { fields: [] },
      type: 'mcp-provided',
      safetyLevel: 'danger',
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    };
    vi.mocked(listTools).mockReturnValue([highDangerTool]);
    vi.mocked(waitForConfirmation).mockResolvedValue(false);

    const result = await executeToolCall(makeToolCall('danger'), CTX);

    expect(waitForConfirmation).toHaveBeenCalled();
    expect(mcpCallTool).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('rejected by user');
  });

  // --- 7. Medium danger does NOT trigger confirmation -------------------
  it('does not gate a medium-danger DB tool on confirmation', async () => {
    const mediumTool: Tool = {
      id: 'db-4',
      name: 'careful',
      description: '',
      inputSchema: { fields: [] },
      type: 'mcp-provided',
      safetyLevel: 'restricted',
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    };
    vi.mocked(listTools).mockReturnValue([mediumTool]);
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
    vi.mocked(mcpCallTool).mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

    await executeToolCall(makeToolCall('careful'), CTX);

    expect(waitForConfirmation).not.toHaveBeenCalled();
    expect(mcpCallTool).toHaveBeenCalled();
  });

  // --- 8. JSON parse error in arguments → caught ------------------------
  it('catches invalid JSON arguments and returns isError', async () => {
    const exec = builtinExecutor({ content: [{ type: 'text', text: 'x' }] });
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
  it('falls back to MCP route for a tool that is not in the DB', async () => {
    vi.mocked(listTools).mockReturnValue([]); // no DB match
    vi.mocked(listEnabledMcps).mockReturnValue([
      {
        id: 'mcp-7',
        name: 'mc7',
        description: '',
        config: { transport: 'stdio' },
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
      },
    ]);
    vi.mocked(mcpCallTool).mockResolvedValue({ content: [{ type: 'text', text: 'dyn' }] });

    const result = await executeToolCall(makeToolCall('dynamic_tool'), CTX);

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
    const danglingBuiltin: Tool = {
      id: 'db-5',
      name: 'orphan',
      description: '',
      inputSchema: { fields: [] },
      type: 'built-in',
      safetyLevel: 'safe',
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    };
    vi.mocked(listTools).mockReturnValue([danglingBuiltin]);

    const result = await executeToolCall(makeToolCall('orphan'), CTX);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('No executor registered');
    expect(mcpCallTool).not.toHaveBeenCalled();
  });

  // --- 11. MCP route returns no enabled MCPs → friendly error ----------
  it('returns a friendly error when no MCP server is enabled for an mcp-provided DB tool', async () => {
    const mcpTool: Tool = {
      id: 'db-6',
      name: 'remote_only',
      description: '',
      inputSchema: { fields: [] },
      type: 'mcp-provided',
      safetyLevel: 'safe',
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    };
    vi.mocked(listTools).mockReturnValue([mcpTool]);
    vi.mocked(listEnabledMcps).mockReturnValue([]); // none enabled

    const result = await executeToolCall(makeToolCall('remote_only'), CTX);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('No MCP server');
  });

  // --- 12. MCP route falls through to "unknown" if every MCP errors -----
  it('returns "Unknown tool" when the fallback MCP route also fails on every server', async () => {
    vi.mocked(listTools).mockReturnValue([]);
    vi.mocked(listEnabledMcps).mockReturnValue([
      {
        id: 'mcp-err',
        name: 'mcerr',
        description: '',
        config: { transport: 'stdio' },
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
      },
    ]);
    vi.mocked(mcpCallTool).mockRejectedValue(new Error('tool not found'));

    const result = await executeToolCall(makeToolCall('ghost'), CTX);

    // The fallback block swallows the final MCP error and falls through to
    // the "Unknown tool" return.
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Unknown tool');
  });
});
