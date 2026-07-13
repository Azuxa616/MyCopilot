import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { Hono } from 'hono';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { errorMiddleware } from '../../middleware/error.js';
import { tokenAuthMiddleware } from '../../middleware/tokenAuth.js';
import { initDatabase, getDb } from '../../db/index.js';
import { debugRoutes } from '../debug.js';

const TEST_DATA_DIR = resolve('.test-data-debug-route');
const TEST_TOKEN = 'test-token-debug-123';

/**
 * Build an app that mirrors apps/server/src/index.ts gating exactly:
 * mount /api/debug only when MYCOPILOT_DEBUG === '1', and apply the shared
 * tokenAuthMiddleware the same way the real server does. This lets the unit
 * tests assert the full security contract (404 when absent, 401 unauthed,
 * 200 authed) without booting the whole server.
 */
function createApp(): Hono {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.use('/api/*', tokenAuthMiddleware(['/api/health']));
  if (process.env.MYCOPILOT_DEBUG === '1') {
    app.route('/api/debug', debugRoutes);
  }
  return app;
}

beforeAll(() => {
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  initDatabase(TEST_DATA_DIR);
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('auth_token', ?)").run(TEST_TOKEN);
});

afterAll(() => {
  try {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    /* cleanup best-effort */
  }
});

describe('debug route (/api/debug)', () => {
  const originalDebug = process.env.MYCOPILOT_DEBUG;

  afterEach(() => {
    // Restore the original flag state between tests.
    if (originalDebug === undefined) delete process.env.MYCOPILOT_DEBUG;
    else process.env.MYCOPILOT_DEBUG = originalDebug;
  });

  it('returns 404 when MYCOPILOT_DEBUG is unset (endpoint not registered)', async () => {
    delete process.env.MYCOPILOT_DEBUG;
    const app = createApp();
    const res = await app.request('/api/debug', {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 when MYCOPILOT_DEBUG=1 but no auth token provided', async () => {
    process.env.MYCOPILOT_DEBUG = '1';
    const app = createApp();
    const res = await app.request('/api/debug');
    expect(res.status).toBe(401);
  });

  it('returns 200 with all DebugEnvInfo fields when flag=1 and valid auth', async () => {
    process.env.MYCOPILOT_DEBUG = '1';
    const app = createApp();
    const res = await app.request('/api/debug', {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.nodeVersion).toMatch(/^v\d+\.\d+\.\d+/);
    expect(typeof body.platform).toBe('string');
    expect(typeof body.arch).toBe('string');
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.dbPath).toBe('string');
    expect(typeof body.nodeEnv).toBe('string');
    // Exactly the six expected fields, no extras.
    expect(Object.keys(body).sort()).toEqual(
      ['arch', 'dbPath', 'nodeEnv', 'nodeVersion', 'platform', 'uptime'],
    );
  });

  it('never leaks sensitive keywords (token|secret|password|auth_token) in response', async () => {
    process.env.MYCOPILOT_DEBUG = '1';
    const app = createApp();
    const res = await app.request('/api/debug', {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    const text = (await res.text()).toLowerCase();
    expect(text).not.toMatch(/token|secret|password|auth_token/);
  });

  it('dbPath is basename only, never an absolute path', async () => {
    process.env.MYCOPILOT_DEBUG = '1';
    const app = createApp();
    const res = await app.request('/api/debug', {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    const body = (await res.json()) as { dbPath: string };
    expect(body.dbPath).toMatch(/mycopilot\.db$/);
    // Reject Windows drive letters, POSIX home dirs, and backslash segments.
    expect(body.dbPath).not.toMatch(/[a-z]:\\|\/users\/|\/home\/|\\\\/i);
  });
});
