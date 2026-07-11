import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpConfig } from '@my-copilot/shared';

// --- Mocks ---------------------------------------------------------------
// Mock the MCP SDK Client as a constructor whose prototype methods are vi.fn,
// so we can configure connect/close/listTools/callTool before the manager
// constructs instances. We also stub the transport factory so no subprocess
// is spawned.

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  const Client = vi.fn();
  Client.prototype.connect = vi.fn();
  Client.prototype.close = vi.fn();
  Client.prototype.listTools = vi.fn();
  Client.prototype.callTool = vi.fn();
  return { Client };
});

vi.mock('../transport-factory.js', () => ({
  createTransport: vi.fn(() => ({ __mockTransport: true })),
}));

import {
  ensureConnected,
  listTools,
  callTool,
  disconnect,
  disconnectAll,
  listAllTools,
  getConnection,
  __clearConnectionsForTests,
} from '../manager.js';

// Cast the prototype methods to vi.Mock refs for ergonomics.
const proto = Client.prototype as unknown as {
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
};

const stdioConfig: McpConfig = {
  transport: 'stdio',
  command: 'node',
  args: ['server.js'],
};

describe('mcp manager', () => {
  beforeEach(() => {
    proto.connect.mockReset();
    proto.close.mockReset();
    proto.listTools.mockReset();
    proto.callTool.mockReset();
    __clearConnectionsForTests();
  });

  // --- ensureConnected ---------------------------------------------------
  it('ensureConnected connects on first call and caches on second', async () => {
    proto.connect.mockResolvedValue(undefined);

    const c1 = await ensureConnected('m1', stdioConfig);
    const c2 = await ensureConnected('m1', stdioConfig);

    expect(proto.connect).toHaveBeenCalledTimes(1);
    expect(c2).toBe(c1);
    const conn = getConnection('m1');
    expect(conn?.health).toBe('healthy');
  });

  it('ensureConnected marks disconnected on failure and reconnects on retry', async () => {
    proto.connect.mockRejectedValueOnce(new Error('spawn failed'));

    await expect(ensureConnected('m2', stdioConfig)).rejects.toThrow(
      'spawn failed',
    );
    expect(getConnection('m2')?.health).toBe('disconnected');

    // Second attempt: connect succeeds → health becomes healthy.
    proto.connect.mockResolvedValueOnce(undefined);
    const client = await ensureConnected('m2', stdioConfig);
    expect(getConnection('m2')?.health).toBe('healthy');
    expect(client).toBeDefined();
    // close() is invoked on the broken entry before rebuild.
    expect(proto.close).toHaveBeenCalled();
  });

  it('ensureConnected uses different keys for different mcpIds', async () => {
    proto.connect.mockResolvedValue(undefined);
    await ensureConnected('a', stdioConfig);
    await ensureConnected('b', stdioConfig);
    expect(proto.connect).toHaveBeenCalledTimes(2);
    expect(getConnection('a')).toBeDefined();
    expect(getConnection('b')).toBeDefined();
  });

  // --- listTools ---------------------------------------------------------
  it('listTools converts MCP tools to internal Tool shape', async () => {
    proto.connect.mockResolvedValue(undefined);
    proto.listTools.mockResolvedValue({
      tools: [
        {
          name: 'readFile',
          description: 'reads a file',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'file path' },
            },
            required: ['path'],
          },
        },
      ],
    });

    const tools = await listTools('m3', stdioConfig);
    expect(tools).toHaveLength(1);
    const tool = tools[0]!;
    expect(tool.id).toBe('mcp-m3-readFile');
    expect(tool.name).toBe('readFile');
    expect(tool.description).toBe('reads a file');
    expect(tool.type).toBe('mcp-provided');
    expect(tool.safetyLevel).toBe('safe');
    expect(tool.enabled).toBe(true);
    expect(tool.inputSchema.fields).toEqual([
      { name: 'path', type: 'string', description: 'file path', required: true },
    ]);
  });

  it('listTools defaults missing description to empty string', async () => {
    proto.connect.mockResolvedValue(undefined);
    proto.listTools.mockResolvedValue({
      tools: [{ name: 'noDesc', inputSchema: { type: 'object' } }],
    });

    const tools = await listTools('m4', stdioConfig);
    expect(tools[0]!.description).toBe('');
  });

  // --- callTool ----------------------------------------------------------
  it('callTool returns the result from the client', async () => {
    proto.connect.mockResolvedValue(undefined);
    const result = { content: [{ type: 'text', text: '42' }] };
    proto.callTool.mockResolvedValue(result);

    const out = await callTool('m5', stdioConfig, 'compute', { x: 1 });
    expect(out).toEqual(result);
    expect(proto.callTool).toHaveBeenCalledWith(
      { name: 'compute', arguments: { x: 1 } },
      undefined,
      expect.any(Object),
    );
  });

  it('callTool rejects with a timeout error when the deadline passes', async () => {
    proto.connect.mockResolvedValue(undefined);
    // Simulate an SDK call that respects the abort signal but never resolves on its own.
    proto.callTool.mockImplementation(
      (_params: unknown, _schema: unknown, options?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          const signal = options?.signal;
          const onAbort = () => reject(new Error('aborted'));
          if (signal?.aborted) {
            reject(new Error('aborted'));
            return;
          }
          signal?.addEventListener('abort', onAbort, { once: true });
        });
      },
    );

    await expect(
      callTool('m6', stdioConfig, 'slow', {}, undefined, 50),
    ).rejects.toThrow('MCP tool call timed out after 50ms');
  });

  it('callTool forwards an external abort signal', async () => {
    proto.connect.mockResolvedValue(undefined);
    proto.callTool.mockImplementation(
      (_params: unknown, _schema: unknown, options?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          const signal = options?.signal;
          if (signal?.aborted) {
            reject(new Error('aborted'));
            return;
          }
          signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      },
    );

    const controller = new AbortController();
    const promise = callTool(
      'm7',
      stdioConfig,
      'work',
      {},
      controller.signal,
      5000,
    );
    controller.abort();
    await expect(promise).rejects.toThrow();
  });

  // --- disconnect --------------------------------------------------------
  it('disconnect closes the client and removes the entry', async () => {
    proto.connect.mockResolvedValue(undefined);
    proto.close.mockResolvedValue(undefined);

    await ensureConnected('m8', stdioConfig);
    expect(getConnection('m8')).toBeDefined();

    await disconnect('m8');
    expect(getConnection('m8')).toBeUndefined();
    expect(proto.close).toHaveBeenCalledTimes(1);
  });

  it('disconnect is a no-op for an unknown id', async () => {
    await expect(disconnect('unknown')).resolves.toBeUndefined();
    expect(proto.close).not.toHaveBeenCalled();
  });

  it('disconnectAll closes every active connection', async () => {
    proto.connect.mockResolvedValue(undefined);
    proto.close.mockResolvedValue(undefined);

    await ensureConnected('x', stdioConfig);
    await ensureConnected('y', stdioConfig);

    await disconnectAll();
    expect(getConnection('x')).toBeUndefined();
    expect(getConnection('y')).toBeUndefined();
    expect(proto.close).toHaveBeenCalledTimes(2);
  });

  // --- listAllTools ------------------------------------------------------
  it('listAllTools merges tools from multiple MCPs', async () => {
    proto.connect.mockResolvedValue(undefined);
    proto.listTools
      .mockResolvedValueOnce({
        tools: [{ name: 'a', inputSchema: { type: 'object' } }],
      })
      .mockResolvedValueOnce({
        tools: [{ name: 'b', inputSchema: { type: 'object' } }],
      });

    const tools = await listAllTools([
      { id: 'm-a', config: stdioConfig },
      { id: 'm-b', config: stdioConfig },
    ]);
    expect(tools.map((t) => t.name).sort()).toEqual(['a', 'b']);
  });

  it('listAllTools swallows per-MCP failures and returns the rest', async () => {
    proto.connect.mockResolvedValue(undefined);
    proto.listTools
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({
        tools: [{ name: 'ok', inputSchema: { type: 'object' } }],
      });

    const tools = await listAllTools([
      { id: 'broken', config: stdioConfig },
      { id: 'good', config: stdioConfig },
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('ok');
  });
});
