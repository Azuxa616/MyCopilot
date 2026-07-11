import { Hono } from 'hono';
import {
  listSessions,
  getSession,
  createSession,
  updateSession,
  deleteSession,
} from '../repo/session.js';
import { listMessagesBySession } from '../repo/message.js';
import { listSummariesBySession } from '../repo/summary.js';
import { successResponse } from '../utils/response.js';
import { HttpError } from '../middleware/error.js';
import type { CreateSessionParams } from '@my-copilot/shared';

export const sessionsApp = new Hono();

sessionsApp.get('/', (c) => {
  const data = listSessions();
  return successResponse(c, data);
});

sessionsApp.post('/', async (c) => {
  const body = await c.req.json<CreateSessionParams>();
  if (body.title && body.title.length > 200) {
    throw new HttpError(400, 'Title must be 200 characters or less');
  }
  const data = createSession(body);
  return successResponse(c, data, 201);
});

sessionsApp.get('/:id', (c) => {
  const id = c.req.param('id');
  const data = getSession(id);
  if (!data) {
    throw new HttpError(404, 'Session not found');
  }
  return successResponse(c, data);
});

sessionsApp.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const data = updateSession(id, body);
  if (!data) {
    throw new HttpError(404, 'Session not found');
  }
  return successResponse(c, data);
});

sessionsApp.delete('/:id', (c) => {
  const id = c.req.param('id');
  const deleted = deleteSession(id);
  if (!deleted) {
    throw new HttpError(404, 'Session not found');
  }
  return successResponse(c, { deleted });
});

sessionsApp.get('/:id/messages', (c) => {
  const id = c.req.param('id');
  const data = listMessagesBySession(id);
  return successResponse(c, data);
});

sessionsApp.get('/:id/summaries', (c) => {
  const id = c.req.param('id');
  const data = listSummariesBySession(id);
  return successResponse(c, data);
});
