import { Hono } from 'hono';
import {
  listTools,
  getTool,
  updateTool,
} from '../repo/tool.js';
import { successResponse } from '../utils/response.js';
import { HttpError } from '../middleware/error.js';
import { executeToolCall } from '../tools/executor.js';
import { listRegisteredTools } from '../tools/registry.js';
import {
  resolveToolApproval,
  getPendingToolApproval,
} from '../tools/confirmation.js';
import type {
  SafetyLevel,
  UpdateToolParams,
  ToolCall,
} from '@my-copilot/shared';

export const toolsApp = new Hono();

toolsApp.get('/', (c) => {
  const enabledFilter = c.req.query('enabled');
  const registeredTools = listRegisteredTools();
  const managedTools = listTools().filter((tool) => tool.type === 'mcp-provided');
  const allTools = [...registeredTools, ...managedTools];
  let data = allTools;
  if (enabledFilter === 'true') {
    data = allTools.filter((tool) => tool.enabled);
  } else if (enabledFilter === 'false') {
    data = allTools.filter((tool) => !tool.enabled);
  }
  return successResponse(c, data);
});

toolsApp.post('/', () => {
  throw new HttpError(
    405,
    'Tools cannot be created manually; register built-ins in code or sync an MCP server',
  );
});

toolsApp.get('/:id', (c) => {
  const id = c.req.param('id');
  const data = getTool(id) ?? listRegisteredTools().find((tool) => tool.id === id);
  if (!data) {
    throw new HttpError(404, 'Tool not found');
  }
  return successResponse(c, data);
});

toolsApp.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<UpdateToolParams>();
  const existing = getTool(id);
  if (!existing) {
    const builtin = listRegisteredTools().find((tool) => tool.id === id);
    if (builtin) throw new HttpError(403, 'Built-in tools are read-only');
    throw new HttpError(404, 'Tool not found');
  }
  if (existing.type !== 'mcp-provided') {
    throw new HttpError(403, 'Built-in tools are read-only');
  }
  const unsupportedFields = Object.keys(body).filter(
    (key) => key !== 'safetyLevel' && key !== 'enabled',
  );
  if (unsupportedFields.length > 0) {
    throw new HttpError(400, 'Only safetyLevel and enabled can be updated');
  }
  if (body.safetyLevel !== undefined) assertSafetyLevel(body.safetyLevel);
  if (body.safetyLevel === 'safe') {
    throw new HttpError(400, 'MCP-provided tools cannot be marked safe');
  }
  const data = updateTool(id, body);
  if (!data) {
    throw new HttpError(404, 'Tool not found');
  }
  return successResponse(c, data);
});

toolsApp.delete('/:id', () => {
  throw new HttpError(
    405,
    'Tools are removed by unregistering built-ins or deleting their MCP server',
  );
});

/**
 * POST /:id/test — execute a tool with caller-supplied arguments for manual testing.
 *
 * Body: { arguments: Record<string, unknown> }
 *
 * Safe tools execute directly and return the full result (content + isError).
 * Restricted/danger tools return an error indicating confirmation is required —
 * they can only be exercised through the agent loop (chat) where the full
 * confirmation flow (SSE → approval dialog → resolve) is wired up.
 */
toolsApp.post('/:id/test', async (c) => {
  const id = c.req.param('id');
  const tool = getTool(id) ?? listRegisteredTools().find((item) => item.id === id);
  if (!tool) {
    throw new HttpError(404, 'Tool not found');
  }

  const body = await c.req.json<{ arguments?: Record<string, unknown> }>().catch(() => ({ arguments: {} }));

  const toolCall: ToolCall = {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: tool.name,
    arguments: JSON.stringify(body.arguments ?? {}),
  };

  const result = await executeToolCall(toolCall, {
    sessionId: `test-session:${id}`,
    agentId: 'test',
  });
  return successResponse(c, result);
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
toolsApp.post('/confirm/:approvalId', async (c) => {
  const approvalId = c.req.param('approvalId');
  const body = await c.req.json<{ approved: boolean }>();
  if (typeof body.approved !== 'boolean') {
    throw new HttpError(400, 'approved must be a boolean');
  }
  const approval = resolveToolApproval(approvalId, body.approved);
  if (!approval) {
    throw new HttpError(404, 'No pending confirmation for this approvalId');
  }
  return successResponse(c, approval);
});

/**
 * POST /calls/:callId — poll a pending high-danger confirmation.
 *
 * Returns the `toolCall` that's awaiting confirmation and its `expiresAt`
 * timestamp so the frontend can render a "confirm within X seconds" UI.
 * 404 if the call isn't pending (already resolved or unknown).
 */
toolsApp.get('/calls/:approvalId', (c) => {
  const approvalId = c.req.param('approvalId');
  const pending = getPendingToolApproval(approvalId);
  if (!pending) {
    throw new HttpError(404, 'No pending confirmation for this approvalId');
  }
  return successResponse(c, pending);
});

function assertSafetyLevel(level: SafetyLevel): void {
  if (!['safe', 'restricted', 'danger'].includes(level)) {
    throw new HttpError(400, 'Invalid safetyLevel');
  }
}
