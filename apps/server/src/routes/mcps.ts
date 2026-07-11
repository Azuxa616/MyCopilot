import { Hono } from 'hono';
import {
  listMcps,
  getMcp,
  createMcp,
  updateMcp,
  deleteMcp,
} from '../repo/mcp.js';
import { listTools, disconnect } from '../mcp/index.js';
import { successResponse } from '../utils/response.js';
import { HttpError } from '../middleware/error.js';
import type {
  CreateMcpParams,
  UpdateMcpParams,
  McpConfig,
} from '@my-copilot/shared';

export const mcpsApp = new Hono();

const VALID_TRANSPORTS: ReadonlySet<string> = new Set(['stdio', 'sse', 'http']);

function validateMcpConfig(config: unknown): asserts config is McpConfig {
  if (!config || typeof config !== 'object') {
    throw new HttpError(400, 'Missing required field: config');
  }
  const c = config as Record<string, unknown>;
  const transport = c.transport;
  if (typeof transport !== 'string' || !VALID_TRANSPORTS.has(transport)) {
    throw new HttpError(400, 'config.transport must be one of: stdio, sse, http');
  }
  if (transport === 'stdio') {
    if (typeof c.command !== 'string' || c.command.trim().length === 0) {
      throw new HttpError(400, 'stdio transport requires a non-empty config.command');
    }
  } else {
    if (typeof c.url !== 'string' || c.url.trim().length === 0) {
      throw new HttpError(400, `${transport} transport requires a non-empty config.url`);
    }
  }
}

mcpsApp.get('/', (c) => {
  const data = listMcps();
  return successResponse(c, data);
});

mcpsApp.post('/', async (c) => {
  const body = await c.req.json();
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    throw new HttpError(400, 'Missing required field: name');
  }
  if (typeof body.description !== 'string') {
    throw new HttpError(400, 'Missing required field: description');
  }
  validateMcpConfig(body.config);

  const params: CreateMcpParams = {
    name: body.name,
    description: body.description,
    config: body.config,
  };
  if (body.enabled !== undefined) params.enabled = Boolean(body.enabled);

  const data = createMcp(params);
  return successResponse(c, data, 201);
});

mcpsApp.get('/:id', (c) => {
  const id = c.req.param('id');
  const data = getMcp(id);
  if (!data) {
    throw new HttpError(404, 'MCP not found');
  }
  return successResponse(c, data);
});

mcpsApp.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  if (body && body.config !== undefined) {
    validateMcpConfig(body.config);
  }
  const data = updateMcp(id, body as UpdateMcpParams);
  if (!data) {
    throw new HttpError(404, 'MCP not found');
  }
  return successResponse(c, data);
});

mcpsApp.delete('/:id', async (c) => {
  const id = c.req.param('id');
  // Drop any live subprocess connection before removing the row.
  try {
    await disconnect(id);
  } catch {
    // best-effort — connection may already be gone
  }
  const deleted = deleteMcp(id);
  if (!deleted) {
    throw new HttpError(404, 'MCP not found');
  }
  return successResponse(c, { deleted });
});

mcpsApp.post('/:id/test', async (c) => {
  const id = c.req.param('id');
  const mcp = getMcp(id);
  if (!mcp) {
    throw new HttpError(404, 'MCP not found');
  }

  try {
    const tools = await listTools(id, mcp.config);
    return c.json({
      code: 0,
      msg: 'ok',
      data: { success: true, tools },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Connection failed';
    return c.json({
      code: -1,
      msg,
      data: { success: false, error: msg },
    });
  }
});
