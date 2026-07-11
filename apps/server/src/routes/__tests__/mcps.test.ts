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
  listTools: vi.fn(),
  disconnect: vi.fn().mockResolvedValue(undefined),
}));

import {
  listMcps,
  getMcp,
  createMcp,
  updateMcp,
  deleteMcp,
} from '../../repo/mcp.js';
import { listTools, disconnect } from '../../mcp/index.js';

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
  });

  it('GET / returns list of mcps', async () => {
    const mockList = [mockMcp()];
    vi.mocked(listMcps).mockReturnValue(mockList);

    const app = createTestApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
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
    const body = await res.json() as any;
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
    const body = await res.json() as any;
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
    const body = await res.json() as any;
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
    const body = await res.json() as any;
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
    const body = await res.json() as any;
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
    const body = await res.json() as any;
    expect(body.msg).toContain('transport');
  });

  it('GET /:id returns mcp when found', async () => {
    const mcp = mockMcp();
    vi.mocked(getMcp).mockReturnValue(mcp);

    const app = createTestApp();
    const res = await app.request('/m1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual(mcp);
  });

  it('GET /:id returns 404 when not found', async () => {
    vi.mocked(getMcp).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/m1');
    expect(res.status).toBe(404);
    const body = await res.json() as any;
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
    const body = await res.json() as any;
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
    const body = await res.json() as any;
    expect(body.data.deleted).toBe(true);
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
    const tools = [{ id: 't1', name: 'readFile' }] as any;
    vi.mocked(listTools).mockResolvedValue(tools);

    const app = createTestApp();
    const res = await app.request('/m1/test', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.code).toBe(0);
    expect(body.data.success).toBe(true);
    expect(body.data.tools).toEqual(tools);
    expect(listTools).toHaveBeenCalledWith('m1', mcp.config);
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
    vi.mocked(listTools).mockRejectedValue(new Error('spawn ENOENT'));

    const app = createTestApp();
    const res = await app.request('/m1/test', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.code).toBe(-1);
    expect(body.data.success).toBe(false);
    expect(body.msg).toContain('ENOENT');
  });

  it('DELETE /:id disconnects the mcp before deleting', async () => {
    vi.mocked(deleteMcp).mockReturnValue(true);

    const app = createTestApp();
    const res = await app.request('/m1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.deleted).toBe(true);
    expect(disconnect).toHaveBeenCalledWith('m1');
  });
});
