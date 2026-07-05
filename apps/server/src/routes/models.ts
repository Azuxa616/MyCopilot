import { Hono } from 'hono';
import {
  listModelsByProvider,
  getModel,
  createModel,
  updateModel,
  deleteModel,
} from '../repo/model.js';
import { successResponse } from '../utils/response.js';
import { HttpError } from '../middleware/error.js';
import type { CreateModelParams } from '@my-copilot/shared';

export const modelsApp = new Hono();

modelsApp.get('/', (c) => {
  const providerId = c.req.param('providerId');
  if (!providerId) {
    throw new HttpError(400, 'Missing providerId');
  }
  const data = listModelsByProvider(providerId);
  return successResponse(c, data);
});

modelsApp.post('/', async (c) => {
  const providerId = c.req.param('providerId');
  if (!providerId) {
    throw new HttpError(400, 'Missing providerId');
  }
  const body = await c.req.json<CreateModelParams>();

  if (!body.name) {
    throw new HttpError(400, 'Missing required field: name');
  }
  if (body.name.length > 100) {
    throw new HttpError(400, 'Name must be 100 characters or less');
  }
  if (body.displayName && body.displayName.length > 100) {
    throw new HttpError(400, 'Display name must be 100 characters or less');
  }

  const data = createModel(providerId, body);
  return successResponse(c, data, 201);
});

modelsApp.get('/:id', (c) => {
  const id = c.req.param('id');
  const data = getModel(id);
  if (!data) {
    throw new HttpError(404, 'Model not found');
  }
  return successResponse(c, data);
});

modelsApp.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const data = updateModel(id, body);
  if (!data) {
    throw new HttpError(404, 'Model not found');
  }
  return successResponse(c, data);
});

modelsApp.delete('/:id', (c) => {
  const id = c.req.param('id');
  const deleted = deleteModel(id);
  if (!deleted) {
    throw new HttpError(404, 'Model not found');
  }
  return successResponse(c, { deleted });
});
