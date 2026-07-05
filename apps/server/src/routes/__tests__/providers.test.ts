import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorMiddleware } from '../../middleware/error.js';
import { providersApp } from '../providers.js';

vi.mock('../../repo/provider.js', () => ({
  listProviders: vi.fn(),
  getProvider: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
}));

vi.mock('../../llm/tester.js', () => ({
  testProvider: vi.fn(),
}));

import { listProviders, getProvider, createProvider, updateProvider, deleteProvider } from '../../repo/provider.js';
import { testProvider } from '../../llm/tester.js';

function createTestApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/', providersApp);
  return app;
}

describe('providers route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET / returns list of providers', async () => {
    const mockProviders = [{ id: 'p1', name: 'OpenAI', type: 'openai' as const, baseUrl: 'https://api.openai.com', apiKey: 'sk-test', enabled: true, createdAt: 1, updatedAt: 1 }];
    vi.mocked(listProviders).mockReturnValue(mockProviders);

    const app = createTestApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toEqual({ code: 0, msg: 'ok', data: mockProviders });
  });

  it('POST / creates provider with valid body', async () => {
    const mockProvider = { id: 'p1', name: 'OpenAI', type: 'openai' as const, baseUrl: 'https://api.openai.com', apiKey: 'sk-test', enabled: true, createdAt: 1, updatedAt: 1 };
    vi.mocked(createProvider).mockReturnValue(mockProvider);

    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-test' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data).toEqual(mockProvider);
  });

  it('POST / returns 400 when required fields are missing', async () => {
    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'OpenAI' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.code).toBe(400);
    expect(body.msg).toContain('Missing required fields');
  });

  it('GET /:id returns provider when found', async () => {
    const mockProvider = { id: 'p1', name: 'OpenAI', type: 'openai' as const, baseUrl: 'https://api.openai.com', apiKey: '', enabled: true, createdAt: 1, updatedAt: 1 };
    vi.mocked(getProvider).mockReturnValue(mockProvider);

    const app = createTestApp();
    const res = await app.request('/p1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual(mockProvider);
  });

  it('GET /:id returns 404 when not found', async () => {
    vi.mocked(getProvider).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/p1');
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
  });

  it('PATCH /:id updates provider', async () => {
    const updated = { id: 'p1', name: 'Updated', type: 'openai' as const, baseUrl: 'https://api.openai.com', apiKey: '', enabled: true, createdAt: 1, updatedAt: 2 };
    vi.mocked(updateProvider).mockReturnValue(updated);

    const app = createTestApp();
    const res = await app.request('/p1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual(updated);
  });

  it('PATCH /:id returns 404 when not found', async () => {
    vi.mocked(updateProvider).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/p1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
  });

  it('DELETE /:id deletes provider', async () => {
    vi.mocked(deleteProvider).mockReturnValue(true);

    const app = createTestApp();
    const res = await app.request('/p1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.deleted).toBe(true);
  });

  it('DELETE /:id returns 404 when not found', async () => {
    vi.mocked(deleteProvider).mockReturnValue(false);

    const app = createTestApp();
    const res = await app.request('/p1', { method: 'DELETE' });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
  });

  it('POST /:id/test returns test result', async () => {
    const mockProvider = { id: 'p1', name: 'OpenAI', type: 'openai' as const, baseUrl: 'https://api.openai.com', apiKey: 'sk-test', enabled: true, createdAt: 1, updatedAt: 1 };
    vi.mocked(getProvider).mockReturnValue(mockProvider);
    vi.mocked(testProvider).mockResolvedValue({ success: true, latencyMs: 100 });

    const app = createTestApp();
    const res = await app.request('/p1/test', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual({ success: true, latencyMs: 100 });
  });

  it('POST /:id/test returns 404 when provider not found', async () => {
    vi.mocked(getProvider).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/p1/test', { method: 'POST' });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
  });
});
