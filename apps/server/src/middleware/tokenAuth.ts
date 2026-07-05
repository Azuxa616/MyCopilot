import type { MiddlewareHandler } from 'hono';
import { getDb } from '../db/index.js';
import { HttpError } from './error.js';

export function tokenAuthMiddleware(publicPaths: string[]): MiddlewareHandler {
  return async (c, next) => {
    // Skip public paths
    if (publicPaths.some(p => c.req.path === p || c.req.path.startsWith(p + '/'))) {
      await next();
      return;
    }

    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new HttpError(401, 'Unauthorized');
    }

    const token = authHeader.slice(7);
    const db = getDb();
    const row = db.prepare("SELECT value FROM config WHERE key = 'auth_token'").get() as { value: string } | undefined;

    if (!row || row.value !== token) {
      throw new HttpError(401, 'Unauthorized');
    }

    await next();
  };
}
