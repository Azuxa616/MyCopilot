import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorMiddleware } from '../../middleware/error.js';
import { healthApp } from '../health.js';

vi.mock('../../db/index.js', () => ({
  getDb: vi.fn(),
}));

import { getDb } from '../../db/index.js';

function createTestApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/', healthApp);
  return app;
}

describe('health route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns structured health response with db connected', async () => {
    const mockPrepare = vi.fn(() => ({ get: vi.fn() }));
    vi.mocked(getDb).mockReturnValue({ prepare: mockPrepare } as any);

    const app = createTestApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'ok',
      db: 'connected',
      version: expect.any(String),
      uptime: expect.any(Number),
    });
  });

  it('returns db error when database is unreachable', async () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error('DB unreachable');
    });

    const app = createTestApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'ok',
      db: 'error',
      version: expect.any(String),
      uptime: expect.any(Number),
    });
  });
});
