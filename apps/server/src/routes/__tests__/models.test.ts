import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorMiddleware } from '../../middleware/error.js';
import { modelsApp } from '../models.js';

vi.mock('../../repo/model.js', () => ({
  listModelsByProvider: vi.fn(),
  getModel: vi.fn(),
  createModel: vi.fn(),
  updateModel: vi.fn(),
  deleteModel: vi.fn(),
}));

import { listModelsByProvider, getModel, createModel, updateModel, deleteModel } from '../../repo/model.js';

function createTestApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/providers/:providerId/models', modelsApp);
  return app;
}

describe('models route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET / returns list of models for provider', async () => {
    const mockModels = [{ id: 'm1', providerId: 'p1', name: 'gpt-4', enabled: true, createdAt: 1, updatedAt: 1 }];
    vi.mocked(listModelsByProvider).mockReturnValue(mockModels);

    const app = createTestApp();
    const res = await app.request('/providers/p1/models');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toEqual({ code: 0, msg: 'ok', data: mockModels });
  });

  it('POST / creates model with valid body', async () => {
    const mockModel = { id: 'm1', providerId: 'p1', name: 'gpt-4', enabled: true, createdAt: 1, updatedAt: 1 };
    vi.mocked(createModel).mockReturnValue(mockModel);

    const app = createTestApp();
    const res = await app.request('/providers/p1/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'gpt-4' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data).toEqual(mockModel);
    expect(createModel).toHaveBeenCalledWith('p1', { name: 'gpt-4' });
  });

  it('POST / returns 400 when name is missing', async () => {
    const app = createTestApp();
    const res = await app.request('/providers/p1/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.code).toBe(400);
    expect(body.msg).toContain('Missing required field');
  });

  it('GET /:id returns model when found', async () => {
    const mockModel = { id: 'm1', providerId: 'p1', name: 'gpt-4', enabled: true, createdAt: 1, updatedAt: 1 };
    vi.mocked(getModel).mockReturnValue(mockModel);

    const app = createTestApp();
    const res = await app.request('/providers/p1/models/m1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual(mockModel);
  });

  it('GET /:id returns 404 when not found', async () => {
    vi.mocked(getModel).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/providers/p1/models/m1');
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
  });

  it('PATCH /:id updates model', async () => {
    const updated = { id: 'm1', providerId: 'p1', name: 'gpt-4-turbo', enabled: true, createdAt: 1, updatedAt: 2 };
    vi.mocked(updateModel).mockReturnValue(updated);

    const app = createTestApp();
    const res = await app.request('/providers/p1/models/m1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'gpt-4-turbo' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual(updated);
  });

  it('PATCH /:id returns 404 when not found', async () => {
    vi.mocked(updateModel).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/providers/p1/models/m1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'gpt-4-turbo' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
  });

  it('DELETE /:id deletes model', async () => {
    vi.mocked(deleteModel).mockReturnValue(true);

    const app = createTestApp();
    const res = await app.request('/providers/p1/models/m1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.deleted).toBe(true);
  });

  it('DELETE /:id returns 404 when not found', async () => {
    vi.mocked(deleteModel).mockReturnValue(false);

    const app = createTestApp();
    const res = await app.request('/providers/p1/models/m1', { method: 'DELETE' });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
  });
});
