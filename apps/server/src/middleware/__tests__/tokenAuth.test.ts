import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tokenAuthMiddleware } from '../tokenAuth.js';
import { errorMiddleware } from '../error.js';
import { initDatabase, getDb } from '../../db/index.js';

const TEST_DATA_DIR = resolve('.test-data-token-auth');

function createTestApp(publicPaths: string[] = ['/api/health']) {
  const app = new Hono();

  app.use('/api/*', tokenAuthMiddleware(publicPaths));

  app.onError(errorMiddleware());

  // Protected route that requires token
  app.get('/api/sessions', (c) => c.json({ data: [] }));

  // Health route should already be public via middleware
  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  return app;
}

beforeAll(() => {
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  initDatabase(TEST_DATA_DIR);

  // Insert a known token for testing
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('auth_token', 'test-token-123')").run();
});

afterAll(() => {
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
});

describe('tokenAuthMiddleware', () => {
  const app = createTestApp();

  it('should return 401 when no Authorization header', async () => {
    const res = await app.request('/api/sessions');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { msg?: string };
    expect(body.msg).toBe('Unauthorized');
  });

  it('should return 401 with wrong token', async () => {
    const res = await app.request('/api/sessions', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { msg?: string };
    expect(body.msg).toBe('Unauthorized');
  });

  it('should pass with correct token', async () => {
    const res = await app.request('/api/sessions', {
      headers: { Authorization: 'Bearer test-token-123' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ data: [] });
  });

  it('/api/health without token should pass (public path)', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });

  it('should return 401 with empty Bearer token', async () => {
    const res = await app.request('/api/sessions', {
      headers: { Authorization: 'Bearer ' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { msg?: string };
    expect(body.msg).toBe('Unauthorized');
  });

  it('should return 401 with non-Bearer auth scheme', async () => {
    const res = await app.request('/api/sessions', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { msg?: string };
    expect(body.msg).toBe('Unauthorized');
  });

  it('should return 401 with no auth scheme (raw token)', async () => {
    const res = await app.request('/api/sessions', {
      headers: { Authorization: 'test-token-123' },
    });
    expect(res.status).toBe(401);
  });
});

describe('tokenAuthMiddleware demo token', () => {
  function createDemoApp() {
    const app = new Hono();
    app.use('/api/*', tokenAuthMiddleware(['/api/health'], 'demo-token-456'));
    app.onError(errorMiddleware());

    app.get('/api/sessions', (c) => c.json({ data: [] }));
    app.post('/api/sessions', (c) => c.json({ data: {} }, 201));
    app.get('/api/models', (c) => c.json({ data: [] }));
    app.get('/api/providers', (c) => c.json({ data: [] }));
    app.get('/api/jobs/abc', (c) => c.json({ data: {} }));
    app.post('/api/jobs/abc/cancel', (c) => c.json({ data: {} }));
    app.get('/api/auth/me', (c) => c.json({ data: { role: 'demo' } }));
    return app;
  }

  const demoApp = createDemoApp();

  it('demo token can GET /api/models (whitelisted)', async () => {
    const res = await demoApp.request('/api/models', {
      headers: { Authorization: 'Bearer demo-token-456' },
    });
    expect(res.status).toBe(200);
  });

  it('demo token can POST /api/sessions (whitelisted)', async () => {
    const res = await demoApp.request('/api/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer demo-token-456' },
    });
    expect(res.status).toBe(201);
  });

  it('demo token can GET /api/jobs/:id and POST cancel (whitelisted)', async () => {
    const res1 = await demoApp.request('/api/jobs/abc', {
      headers: { Authorization: 'Bearer demo-token-456' },
    });
    expect(res1.status).toBe(200);
    const res2 = await demoApp.request('/api/jobs/abc/cancel', {
      method: 'POST',
      headers: { Authorization: 'Bearer demo-token-456' },
    });
    expect(res2.status).toBe(200);
  });

  it('demo token gets 403 on /api/providers (not whitelisted)', async () => {
    const res = await demoApp.request('/api/providers', {
      headers: { Authorization: 'Bearer demo-token-456' },
    });
    expect(res.status).toBe(403);
  });

  it('admin token (config table) bypasses whitelist on /api/providers', async () => {
    const res = await demoApp.request('/api/providers', {
      headers: { Authorization: 'Bearer test-token-123' },
    });
    expect(res.status).toBe(200);
  });

  it('unknown token gets 401 even on whitelisted route', async () => {
    const res = await demoApp.request('/api/models', {
      headers: { Authorization: 'Bearer no-such-token' },
    });
    expect(res.status).toBe(401);
  });

  it('without demoToken configured, demo-like token gets 401', async () => {
    const app = new Hono();
    app.use('/api/*', tokenAuthMiddleware(['/api/health']));
    app.onError(errorMiddleware());
    app.get('/api/sessions', (c) => c.json({ data: [] }));
    const res = await app.request('/api/sessions', {
      headers: { Authorization: 'Bearer demo-token-456' },
    });
    expect(res.status).toBe(401);
  });
});
