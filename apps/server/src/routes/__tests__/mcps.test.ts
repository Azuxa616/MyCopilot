import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorMiddleware } from '../../middleware/error.js';
import { mcpsApp } from '../mcps.js';

vi.mock('../../repo/mcp.js', () => ({
  listMcps: vi.fn(),
  listEnabledMcps: vi.fn(),
  getMcp: vi.fn(),
  createMcp: vi.fn(),
  updateMcp: vi.fn(),
  deleteMcp: vi.fn(),
}));



vi.mock('../../mcp/index.js', () => ({
  disconnect: vi.fn().mockResolvedValue(undefined),
  synchronizeMcpTools: vi.fn(),
  trySynchronizeMcpTools: vi.fn().mockResolvedValue(null),
  testConnection: vi.fn(),
}));

vi.mock('../../repo/tool.js', () => ({
  deleteToolsByMcp: vi.fn(),
}));

import {
  listMcps,
  getMcp,
  createMcp,
  updateMcp,
  deleteMcp,
} from '../../repo/mcp.js';
import {
  disconnect,
  synchronizeMcpTools,
  trySynchronizeMcpTools,
  testConnection,
} from '../../mcp/index.js';
import { deleteToolsByMcp } from '../../repo/tool.js';
import type { Tool } from '@my-copilot/shared';

type ApiResponse = {
  code: number;
  msg: string;
  data: Record<string, unknown>;
};

function createTestApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/', mcpsApp);
  return app;
}

const stdioConfig = { transport: 'stdio' as const, command: 'npx', args: ['-y'] };
const httpConfig = { transport: 'http' as const, url: 'https://example.com/mcp' };

function mockMcp(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'm1',
    name: 'filesystem',
    description: 'fs mcp',
    config: stdioConfig,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('mcps route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(synchronizeMcpTools).mockResolvedValue({
      created: 0,
      updated: 0,
      disabled: 0,
      tools: [],
    });
  });

  it('GET / returns list of mcps', async () => {
    const mockList = [mockMcp()];
    vi.mocked(listMcps).mockReturnValue(mockList);

    const app = createTestApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body).toEqual({ code: 0, msg: 'ok', data: mockList });
  });

  it('POST / creates mcp with valid stdio config', async () => {
    const created = mockMcp();
    vi.mocked(createMcp).mockReturnValue(created);

    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'filesystem', description: 'fs mcp', config: stdioConfig }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ApiResponse;
    expect(body.data).toEqual(created);
    expect(createMcp).toHaveBeenCalledWith({
      name: 'filesystem',
      description: 'fs mcp',
      config: stdioConfig,
    });
  });

  it('POST / creates mcp with valid http config', async () => {
    const created = mockMcp({ config: httpConfig });
    vi.mocked(createMcp).mockReturnValue(created);

    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'remote', description: 'r', config: httpConfig }),
    });
    expect(res.status).toBe(201);
  });

  it('POST / returns 400 when name is missing', async () => {
    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'd', config: stdioConfig }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiResponse;
    expect(body.msg).toContain('name');
  });

  it('POST / returns 400 when description is missing', async () => {
    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', config: stdioConfig }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiResponse;
    expect(body.msg).toContain('description');
  });

  it('POST / returns 400 when stdio config lacks command', async () => {
    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'x',
        description: 'd',
        config: { transport: 'stdio' },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiResponse;
    expect(body.msg).toContain('command');
  });

  it('POST / returns 400 when http config lacks url', async () => {
    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'x',
        description: 'd',
        config: { transport: 'http' },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiResponse;
    expect(body.msg).toContain('url');
  });

  it('POST / returns 400 when transport is invalid', async () => {
    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'x',
        description: 'd',
        config: { transport: 'ftp', url: 'ftp://x' },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiResponse;
    expect(body.msg).toContain('transport');
  });

  it('POST / responds without waiting for background tool sync', async () => {
    const created = mockMcp();
    vi.mocked(createMcp).mockReturnValue(created);
    // Simulate a slow/hung MCP server: tool sync never settles. The route
    // must still respond immediately (sync runs in the background).
    vi.mocked(trySynchronizeMcpTools).mockImplementationOnce(
      () => new Promise(() => {}),
    );

    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'filesystem', description: 'fs mcp', config: stdioConfig }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ApiResponse;
    expect(body.data).toEqual(created);
    expect(trySynchronizeMcpTools).toHaveBeenCalledWith(created);
  });

  it('GET /:id returns mcp when found', async () => {
    const mcp = mockMcp();
    vi.mocked(getMcp).mockReturnValue(mcp);

    const app = createTestApp();
    const res = await app.request('/m1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.data).toEqual(mcp);
  });

  it('GET /:id returns 404 when not found', async () => {
    vi.mocked(getMcp).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/m1');
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiResponse;
    expect(body.code).toBe(404);
  });

  it('PATCH /:id updates mcp', async () => {
    const updated = mockMcp({ name: 'renamed', updatedAt: 2 });
    vi.mocked(updateMcp).mockReturnValue(updated);

    const app = createTestApp();
    const res = await app.request('/m1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'renamed' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.data).toEqual(updated);
  });

  it('PATCH /:id validates config when provided', async () => {
    const app = createTestApp();
    const res = await app.request('/m1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { transport: 'stdio' } }),
    });
    expect(res.status).toBe(400);
    expect(updateMcp).not.toHaveBeenCalled();
  });

  it('PATCH /:id responds without waiting for background tool sync', async () => {
    const updated = mockMcp({ name: 'renamed' });
    vi.mocked(updateMcp).mockReturnValue(updated);
    vi.mocked(trySynchronizeMcpTools).mockImplementationOnce(
      () => new Promise(() => {}),
    );

    const app = createTestApp();
    const res = await app.request('/m1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'renamed' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.data).toEqual(updated);
    expect(trySynchronizeMcpTools).toHaveBeenCalledWith(updated);
  });

  it('PATCH /:id returns 404 when not found', async () => {
    vi.mocked(updateMcp).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/m1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /:id deletes mcp', async () => {
    vi.mocked(deleteMcp).mockReturnValue(true);

    const app = createTestApp();
    const res = await app.request('/m1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.data.deleted).toBe(true);
    expect(deleteToolsByMcp).toHaveBeenCalledWith('m1');
  });

  it('DELETE /:id returns 404 when not found', async () => {
    vi.mocked(deleteMcp).mockReturnValue(false);

    const app = createTestApp();
    const res = await app.request('/m1', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('POST /:id/test returns tools when connection succeeds', async () => {
    const mcp = mockMcp();
    vi.mocked(getMcp).mockReturnValue(mcp);
    const tools: Tool[] = [
      {
        id: 't1',
        name: 'readFile',
        description: '',
        inputSchema: { fields: [] },
        type: 'mcp-provided',
        safetyLevel: 'safe',
        sourceMcpId: 'm1',
        policyVersion: '1',
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    vi.mocked(synchronizeMcpTools).mockResolvedValue({
      created: 1,
      updated: 0,
      disabled: 0,
      tools,
    });

    const app = createTestApp();
    const res = await app.request('/m1/test', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.code).toBe(0);
    expect(body.data.success).toBe(true);
    expect(body.data.tools).toEqual(tools);
    expect(body.data.created).toBe(1);
    expect(synchronizeMcpTools).toHaveBeenCalledWith(mcp);
  });

  it('POST /:id/test returns 404 when mcp not found', async () => {
    vi.mocked(getMcp).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/m1/test', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('POST /:id/test returns failure envelope when connection fails', async () => {
    const mcp = mockMcp();
    vi.mocked(getMcp).mockReturnValue(mcp);
    vi.mocked(synchronizeMcpTools).mockRejectedValue(new Error('spawn ENOENT'));

    const app = createTestApp();
    const res = await app.request('/m1/test', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.code).toBe(-1);
    expect(body.data.success).toBe(false);
    expect(body.msg).toContain('ENOENT');
  });

  it('DELETE /:id disconnects the mcp before deleting', async () => {
    vi.mocked(deleteMcp).mockReturnValue(true);

    const app = createTestApp();
    const res = await app.request('/m1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.data.deleted).toBe(true);
    expect(disconnect).toHaveBeenCalledWith('m1');
  });

  it('disables synchronized tools when an MCP is disabled', async () => {
    const updated = mockMcp({ enabled: false });
    vi.mocked(updateMcp).mockReturnValue(updated);
    const response = await createTestApp().request('/m1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(response.status).toBe(200);
    expect(trySynchronizeMcpTools).toHaveBeenCalledWith(updated);
  });

  describe('POST /test-config', () => {
    beforeEach(() => {
      vi.mocked(testConnection).mockReset();
    });

    it('returns 400 when config is missing transport', async () => {
      const app = createTestApp();
      const res = await app.request('/test-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { command: 'npx' } }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when stdio config has no command', async () => {
      const app = createTestApp();
      const res = await app.request('/test-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: { transport: 'stdio', args: ['-y'] },
        }),
      });
      expect(res.status).toBe(400);
    });

    it('returns success and tool names when testConnection succeeds', async () => {
      vi.mocked(testConnection).mockResolvedValue({
        success: true,
        tools: ['browser_navigate', 'browser_click'],
      });

      const app = createTestApp();
      const res = await app.request('/test-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: stdioConfig }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        code: number;
        data: { success: boolean; tools: string[] };
      };
      expect(body.code).toBe(0);
      expect(body.data.success).toBe(true);
      expect(body.data.tools).toEqual(['browser_navigate', 'browser_click']);
      expect(testConnection).toHaveBeenCalledWith(stdioConfig);
    });

    it('returns code -1 when testConnection reports failure', async () => {
      vi.mocked(testConnection).mockResolvedValue({
        success: false,
        tools: [],
        error: 'spawn ENOENT',
      });

      const app = createTestApp();
      const res = await app.request('/test-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: stdioConfig }),
      });
      // Note: HTTP 200 with code=-1, consistent with POST /:id/test.
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        code: number;
        msg: string;
        data: { success: boolean; error: string };
      };
      expect(body.code).toBe(-1);
      expect(body.msg).toBe('spawn ENOENT');
      expect(body.data.success).toBe(false);
      expect(body.data.error).toBe('spawn ENOENT');
    });
  });
});
