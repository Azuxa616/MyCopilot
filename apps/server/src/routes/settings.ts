import { Hono } from 'hono';
import { ASK_USER_TIMEOUT_CONFIG_KEY } from '@my-copilot/shared';
import * as config from '../repo/config.js';
import { successResponse } from '../utils/response.js';
import { HttpError } from '../middleware/error.js';

const MAX_TIMEOUT_MS = 604_800_000;

export const settingsApp = new Hono();

settingsApp.get('/', (c) => {
  const stored = config.get(ASK_USER_TIMEOUT_CONFIG_KEY);
  const parsed = stored === undefined ? 0 : Number(stored);
  return successResponse(c, { timeoutMs: Number.isInteger(parsed) && parsed > 0 ? parsed : null });
});

settingsApp.put('/', async (c) => {
  const body = await c.req.json<{ timeoutMs?: unknown }>();
  const timeoutMs = body.timeoutMs;
  if (timeoutMs !== null && timeoutMs !== 0 && (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS)) {
    throw new HttpError(400, `timeoutMs 必须为 null、0 或 1..${MAX_TIMEOUT_MS} 的整数。`);
  }
  const normalized = timeoutMs === null || timeoutMs === 0 ? 0 : timeoutMs as number;
  config.set(ASK_USER_TIMEOUT_CONFIG_KEY, String(normalized));
  return successResponse(c, { timeoutMs: normalized === 0 ? null : normalized });
});
