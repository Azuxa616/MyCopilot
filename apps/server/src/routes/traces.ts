import { Hono } from 'hono';
import { listRunsBySession, getRunWithSteps } from '../repo/runTrace.js';
import { successResponse } from '../utils/response.js';
import { HttpError } from '../middleware/error.js';

export const tracesApp = new Hono();

/** ?limit 钳制区间 [1, 50]；缺省或非法值取上限 50。 */
const RUNS_LIMIT_MAX = 50;
const RUNS_LIMIT_DEFAULT = RUNS_LIMIT_MAX;

// GET /api/sessions/:sessionId/runs — 列出会话的执行轨迹（started_at 倒序，
// 含每条 Run 的步骤计数）。?limit 在 [1, 50] 内钳制，越界或非法值不报错。
tracesApp.get('/sessions/:sessionId/runs', (c) => {
  const sessionId = c.req.param('sessionId');
  const parsed = Number.parseInt(c.req.query('limit') ?? '', 10);
  const limit = Number.isNaN(parsed)
    ? RUNS_LIMIT_DEFAULT
    : Math.min(Math.max(parsed, 1), RUNS_LIMIT_MAX);
  const data = listRunsBySession(sessionId).slice(0, limit);
  return successResponse(c, data);
});

// GET /api/runs/:runId — 取单条 Run 及其全部步骤；不存在时 404。
tracesApp.get('/runs/:runId', (c) => {
  const data = getRunWithSteps(c.req.param('runId'));
  if (!data) {
    throw new HttpError(404, 'Run not found');
  }
  return successResponse(c, data);
});
