// apps/server/src/routes/auth.ts
import { Hono } from 'hono';
import type { AuthInfo } from '@my-copilot/shared';

export const authApp = new Hono();

// GET /me — identify the caller's role for the frontend.
// Mounted after tokenAuthMiddleware in index.ts, so the bearer token is
// already validated; here we only classify admin vs demo.
// DEMO_TOKEN/DEMO_MODE are read from env at request time to match the
// auth middleware's env-fresh behavior.
authApp.get('/me', (c) => {
  const authHeader = c.req.header('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const demoToken = process.env.DEMO_TOKEN?.trim() || null;
  const role = demoToken && token === demoToken ? 'demo' : 'admin';
  const demoMode = process.env.DEMO_MODE === '1';
  const info: AuthInfo = { role, demoMode };
  // Bare `{ data }` envelope (same as GET /api/models) — NOT successResponse,
  // whose { code, msg, data } wrapper would change the response shape contract.
  return c.json({ data: info });
});
