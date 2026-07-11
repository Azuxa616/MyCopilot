import { Hono } from 'hono';
import {
  listTools,
  listEnabledTools,
  getTool,
  createTool,
  updateTool,
  deleteTool,
} from '../repo/tool.js';
import { successResponse } from '../utils/response.js';
import { HttpError } from '../middleware/error.js';
import { executeToolCall } from '../tools/executor.js';
import {
  resolveConfirmation,
  getPendingConfirmation,
} from '../tools/confirmation.js';
import type { CreateToolParams, UpdateToolParams, ToolCall } from '@my-copilot/shared';

export const toolsApp = new Hono();

toolsApp.get('/', (c) => {
  const enabledFilter = c.req.query('enabled');
  let data;
  if (enabledFilter === 'true') {
    data = listEnabledTools();
  } else if (enabledFilter === 'false') {
    data = listTools().filter((t) => !t.enabled);
  } else {
    data = listTools();
  }
  return successResponse(c, data);
});

toolsApp.post('/', async (c) => {
  const body = await c.req.json<CreateToolParams>();

  if (!body.name || !body.description || !body.type || !body.dangerLevel) {
    throw new HttpError(400, 'Missing required fields: name, description, type, dangerLevel');
  }
  if (!body.inputSchema || !Array.isArray(body.inputSchema.fields)) {
    throw new HttpError(400, 'Missing or invalid inputSchema');
  }

  const data = createTool(body);
  return successResponse(c, data, 201);
});

toolsApp.get('/:id', (c) => {
  const id = c.req.param('id');
  const data = getTool(id);
  if (!data) {
    throw new HttpError(404, 'Tool not found');
  }
  return successResponse(c, data);
});

toolsApp.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<UpdateToolParams>();
  const data = updateTool(id, body);
  if (!data) {
    throw new HttpError(404, 'Tool not found');
  }
  return successResponse(c, data);
});

toolsApp.delete('/:id', (c) => {
  const id = c.req.param('id');
  const deleted = deleteTool(id);
  if (!deleted) {
    throw new HttpError(404, 'Tool not found');
  }
  return successResponse(c, { deleted });
});

toolsApp.post('/:id/test', (c) => {
  const id = c.req.param('id');
  const tool = getTool(id);
  if (!tool) {
    throw new HttpError(404, 'Tool not found');
  }
  return successResponse(c, { code: 0, msg: 'test placeholder' });
});

// --- Tool execution & confirmation (T10) ---------------------------------
//
// These endpoints sit alongside the CRUD routes above but serve the runtime
// tool-execution path: direct execution for debugging, plus the confirm /
// poll pair that high-danger tools must round-trip through before they run.

/**
 * POST /execute — direct tool execution.
 *
 * Intended for frontend debugging / manual testing. The agent loop calls
 * `executeToolCall` directly rather than going through HTTP, so this route
 * is a thin wrapper that constructs a `ToolCall` from the request body and
 * forwards it.
 *
 * Body: { name: string, arguments: Record<string, unknown>, sessionId: string, id?: string }
 */
toolsApp.post('/execute', async (c) => {
  const body = await c.req.json<{
    name: string;
    arguments: Record<string, unknown>;
    sessionId: string;
    id?: string;
  }>();

  if (!body.name || !body.sessionId) {
    throw new HttpError(400, 'Missing required fields: name, sessionId');
  }

  const toolCall: ToolCall = {
    id: body.id ?? `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: body.name,
    arguments: JSON.stringify(body.arguments ?? {}),
  };

  const result = await executeToolCall(toolCall, { sessionId: body.sessionId });
  return successResponse(c, result);
});

/**
 * POST /confirm/:callId — resolve a pending high-danger confirmation.
 *
 * Body: { approved: boolean }
 *
 * Returns 404 if no confirmation is pending for `callId` (already resolved,
 * timed out, or never created). `callId` is namespaced as `${sessionId}:${toolCallId}`
 * by the executor, so the client must use the same value it received when
 * the call was blocked.
 */
toolsApp.post('/confirm/:callId', async (c) => {
  const callId = c.req.param('callId');
  const body = await c.req.json<{ approved: boolean }>();
  const resolved = resolveConfirmation(callId, body.approved);
  if (!resolved) {
    throw new HttpError(404, 'No pending confirmation for this callId');
  }
  return successResponse(c, { resolved: true });
});

/**
 * POST /calls/:callId — poll a pending high-danger confirmation.
 *
 * Returns the `toolCall` that's awaiting confirmation and its `expiresAt`
 * timestamp so the frontend can render a "confirm within X seconds" UI.
 * 404 if the call isn't pending (already resolved or unknown).
 */
toolsApp.post('/calls/:callId', (c) => {
  const callId = c.req.param('callId');
  const pending = getPendingConfirmation(callId);
  if (!pending) {
    throw new HttpError(404, 'No pending confirmation for this callId');
  }
  return successResponse(c, pending);
});
