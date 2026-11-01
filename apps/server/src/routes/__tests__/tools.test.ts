import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import { createSession } from '../../repo/session.js';
import { createToolApproval } from '../../repo/tool-approval.js';
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

describe('question card confirmation routes', () => {
  let testDir: string;
  let sessionId: string;
  const spec = JSON.stringify({ questions: [{ question: '选择', mode: 'single', options: ['A', 'B'], allowCustomOption: true }] });

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-tools-route-'));
    initDatabase(testDir);
    sessionId = createSession({}).id;
  });

  afterEach(() => {
    getDb().close();
    rmSync(testDir, { recursive: true, force: true });
  });

  function createApproval(name = 'ask_user') {
    return createToolApproval({
      runId: 'run-1', jobId: null, sessionId, agentId: 'default',
      tool: { id: 'builtin-ask-user', name, source: 'built-in', sourceMcpId: null, policyVersion: 'v1' },
      toolCallId: 'call-1', arguments: spec, argumentsDigest: 'digest', resourceScope: 'tool',
      safetyLevel: name === 'ask_user' ? 'safe' : 'danger', policyVersion: 'v1', expiresAt: 0,
    });
  }

  function confirm(approvalId: string, body: unknown) {
    return createTestApp().request(`/confirm/${approvalId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  it('accepts and normalizes an answered question card', async () => {
    const approval = createApproval();
    const response = await confirm(approval.approvalId, { answer: { status: 'answered', answers: [{ index: 0, status: 'answered', selections: ['A'] }] } });
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { state: string } };
    expect(body.data.state).toBe('approved');
  });

  it('rejects invalid selections and duplicate submissions', async () => {
    const approval = createApproval();
    const invalid = await confirm(approval.approvalId, { answer: { status: 'answered', answers: [{ index: 0, status: 'answered', selections: ['C'] }] } });
    expect(invalid.status).toBe(400);
    const valid = { answer: { status: 'answered', answers: [{ index: 0, status: 'answered', selections: ['B'] }] } };
    expect((await confirm(approval.approvalId, valid)).status).toBe(200);
    expect((await confirm(approval.approvalId, valid)).status).toBe(404);
  });

  it('keeps the legacy approved body for other tools', async () => {
    const approval = createApproval('dangerous_action');
    expect((await confirm(approval.approvalId, { approved: true })).status).toBe(200);
  });

  it('lists only pending approvals in the mapped shape', async () => {
    const approval = createApproval();
    const response = await createTestApp().request(`/pending?sessionId=${sessionId}`);
    const body = await response.json() as { data: { approvals: Array<Record<string, unknown>> } };
    expect(body.data.approvals).toEqual([expect.objectContaining({
      approvalId: approval.approvalId, toolCallId: 'call-1', toolName: 'ask_user', arguments: spec,
      safetyLevel: 'safe', source: 'built-in', sourceMcpId: null, expiresAt: 0,
    })]);
    await confirm(approval.approvalId, { answer: { status: 'answered', answers: [{ index: 0, status: 'answered', selections: ['A'] }] } });
    const settled = await createTestApp().request(`/pending?sessionId=${sessionId}`);
    expect((await settled.json() as { data: { approvals: unknown[] } }).data.approvals).toEqual([]);
  });
});
