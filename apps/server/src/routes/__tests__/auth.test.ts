// apps/server/src/routes/__tests__/auth.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { Hono } from 'hono';
import { authApp } from '../auth.js';
import { errorMiddleware } from '../../middleware/error.js';

function createApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/api/auth', authApp);
  return app;
}

describe('GET /api/auth/me', () => {
  const app = createApp();

  afterEach(() => {
    delete process.env.DEMO_MODE;
    delete process.env.DEMO_TOKEN;
  });

  it('returns demo role for demo token in demo mode', async () => {
    process.env.DEMO_MODE = '1';
    process.env.DEMO_TOKEN = 'demo-tok';
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer demo-tok' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { role: 'demo', demoMode: true } });
  });

  it('returns admin role for non-demo token', async () => {
    process.env.DEMO_MODE = '1';
    process.env.DEMO_TOKEN = 'demo-tok';
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer admin-tok' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { role: 'admin', demoMode: true } });
  });

  it('reports demoMode false when DEMO_MODE unset', async () => {
    delete process.env.DEMO_MODE;
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer admin-tok' },
    });
    expect(await res.json()).toEqual({ data: { role: 'admin', demoMode: false } });
  });
});
