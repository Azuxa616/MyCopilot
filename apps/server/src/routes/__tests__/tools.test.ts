import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorMiddleware } from '../../middleware/error.js';
import { toolsApp } from '../tools.js';

vi.mock('../../repo/tool.js', () => ({
  listTools: vi.fn(),
  listEnabledTools: vi.fn(),
  getTool: vi.fn(),
  createTool: vi.fn(),
  updateTool: vi.fn(),
  deleteTool: vi.fn(),
}));

import {
  listTools,
  listEnabledTools,
  getTool,
  createTool,
  updateTool,
  deleteTool,
} from '../../repo/tool.js';

function createTestApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/', toolsApp);
  return app;
}

const sampleTool = {
  id: 't1',
  name: 'search',
  description: 'Web search',
  inputSchema: { fields: [] },
  type: 'built-in' as const,
  safetyLevel: 'safe' as const,
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

describe('tools route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET / returns list of tools', async () => {
    vi.mocked(listTools).mockReturnValue([sampleTool]);

    const app = createTestApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toEqual({ code: 0, msg: 'ok', data: [sampleTool] });
  });

  it('GET /?enabled=true filters enabled tools', async () => {
    vi.mocked(listEnabledTools).mockReturnValue([sampleTool]);

    const app = createTestApp();
    const res = await app.request('/?enabled=true');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual([sampleTool]);
    expect(listEnabledTools).toHaveBeenCalled();
    expect(listTools).not.toHaveBeenCalled();
  });

  it('POST / creates tool with valid body', async () => {
    vi.mocked(createTool).mockReturnValue(sampleTool);

    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'search',
        description: 'Web search',
        inputSchema: { fields: [] },
        type: 'built-in',
        safetyLevel: 'safe',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data).toEqual(sampleTool);
  });

  it('POST / returns 400 when required fields are missing', async () => {
    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'search' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.code).toBe(400);
    expect(body.msg).toContain('Missing required fields');
  });

  it('POST / returns 400 when inputSchema is missing', async () => {
    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'search',
        description: 'd',
        type: 'built-in',
        safetyLevel: 'safe',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.msg).toContain('inputSchema');
  });

  it('GET /:id returns tool when found', async () => {
    vi.mocked(getTool).mockReturnValue(sampleTool);

    const app = createTestApp();
    const res = await app.request('/t1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual(sampleTool);
  });

  it('GET /:id returns 404 when not found', async () => {
    vi.mocked(getTool).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/t1');
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
  });

  it('PATCH /:id updates tool', async () => {
    const updated = { ...sampleTool, name: 'renamed', updatedAt: 2 };
    vi.mocked(updateTool).mockReturnValue(updated);

    const app = createTestApp();
    const res = await app.request('/t1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'renamed' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual(updated);
  });

  it('PATCH /:id returns 404 when not found', async () => {
    vi.mocked(updateTool).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/t1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
  });

  it('DELETE /:id deletes tool', async () => {
    vi.mocked(deleteTool).mockReturnValue(true);

    const app = createTestApp();
    const res = await app.request('/t1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.deleted).toBe(true);
  });

  it('DELETE /:id returns 404 when not found', async () => {
    vi.mocked(deleteTool).mockReturnValue(false);

    const app = createTestApp();
    const res = await app.request('/t1', { method: 'DELETE' });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
  });

  it('POST /:id/test returns placeholder', async () => {
    vi.mocked(getTool).mockReturnValue(sampleTool);

    const app = createTestApp();
    const res = await app.request('/t1/test', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual({ code: 0, msg: 'test placeholder' });
  });

  it('POST /:id/test returns 404 when tool not found', async () => {
    vi.mocked(getTool).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/t1/test', { method: 'POST' });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
  });
});
