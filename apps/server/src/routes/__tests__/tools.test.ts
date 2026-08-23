import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Tool } from '@my-copilot/shared';
import { errorMiddleware } from '../../middleware/error.js';
import { toolsApp } from '../tools.js';

vi.mock('../../repo/tool.js', () => ({
  listTools: vi.fn(),
  getTool: vi.fn(),
  updateTool: vi.fn(),
}));

vi.mock('../../tools/registry.js', () => ({
  listRegisteredTools: vi.fn(),
}));

import { getTool, listTools, updateTool } from '../../repo/tool.js';
import { listRegisteredTools } from '../../tools/registry.js';

const builtin: Tool = {
  id: 'builtin-clock',
  name: 'current_datetime',
  description: 'Current time',
  inputSchema: { fields: [] },
  type: 'built-in',
  safetyLevel: 'safe',
  sourceMcpId: null,
  policyVersion: 'builtin:clock:v1',
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
};

const mcpTool: Tool = {
  id: 'mcp-weather',
  name: 'weather',
  description: 'Weather',
  inputSchema: { fields: [] },
  type: 'mcp-provided',
  safetyLevel: 'restricted',
  sourceMcpId: 'mcp-1',
  policyVersion: 'mcp:weather:v1',
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

function createTestApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/', toolsApp);
  return app;
}

describe('tools route registration model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listRegisteredTools).mockReturnValue([builtin]);
    vi.mocked(listTools).mockReturnValue([mcpTool]);
  });

  it('lists code-registered built-ins and MCP-synchronized tools', async () => {
    const response = await createTestApp().request('/');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Tool[] };
    expect(body.data).toEqual([builtin, mcpTool]);
  });

  it('rejects manual tool creation', async () => {
    const response = await createTestApp().request('/', { method: 'POST' });
    expect(response.status).toBe(405);
  });

  it('treats built-in tools as read-only', async () => {
    vi.mocked(getTool).mockReturnValue(undefined);
    const response = await createTestApp().request('/builtin-clock', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ safetyLevel: 'danger' }),
    });
    expect(response.status).toBe(403);
  });

  it('allows only policy fields on MCP tools', async () => {
    vi.mocked(getTool).mockReturnValue(mcpTool);
    vi.mocked(updateTool).mockReturnValue({ ...mcpTool, safetyLevel: 'danger' });
    const response = await createTestApp().request('/mcp-weather', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ safetyLevel: 'danger' }),
    });
    expect(response.status).toBe(200);
    expect(updateTool).toHaveBeenCalledWith('mcp-weather', { safetyLevel: 'danger' });
  });

  it('rejects metadata edits and direct deletion', async () => {
    vi.mocked(getTool).mockReturnValue(mcpTool);
    const editResponse = await createTestApp().request('/mcp-weather', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'renamed' }),
    });
    const deleteResponse = await createTestApp().request('/mcp-weather', {
      method: 'DELETE',
    });
    expect(editResponse.status).toBe(400);
    expect(deleteResponse.status).toBe(405);
  });
});
