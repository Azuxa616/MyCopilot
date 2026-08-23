import type { MiddlewareHandler } from 'hono';
import { getDb } from '../db/index.js';
import { HttpError } from './error.js';

/**
 * Demo-role route whitelist: method + path regex pairs.
 * Anything NOT matching → 403 for demo tokens (default deny).
 * Spec: docs/superpowers/specs/2026-08-22-demo-deployment-design.md §2
 */
const DEMO_ROUTE_RULES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/api\/models$/ },
  { method: 'GET', pattern: /^\/api\/sessions$/ },
  { method: 'POST', pattern: /^\/api\/sessions$/ },
  { method: 'GET', pattern: /^\/api\/sessions\/[^/]+$/ },
  { method: 'PATCH', pattern: /^\/api\/sessions\/[^/]+$/ },
  { method: 'DELETE', pattern: /^\/api\/sessions\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/sessions\/[^/]+\/messages$/ },
  { method: 'POST', pattern: /^\/api\/sessions\/[^/]+\/messages$/ },
  { method: 'GET', pattern: /^\/api\/sessions\/[^/]+\/summaries$/ },
  { method: 'POST', pattern: /^\/api\/sessions\/[^/]+\/messages\/stop$/ },
  { method: 'DELETE', pattern: /^\/api\/sessions\/[^/]+\/messages\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/jobs$/ },
  { method: 'GET', pattern: /^\/api\/jobs\/stream$/ },
  { method: 'GET', pattern: /^\/api\/jobs\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/jobs\/[^/]+\/cancel$/ },
  { method: 'GET', pattern: /^\/api\/auth\/me$/ },
];

function isDemoRouteAllowed(method: string, path: string): boolean {
  return DEMO_ROUTE_RULES.some(
    (rule) => rule.method === method && rule.pattern.test(path),
  );
}

/**
 * Token auth with optional demo role.
 *
 * - Admin token (config table `auth_token`): full access.
 * - Demo token (optional second arg, from DEMO_TOKEN env): whitelist only.
 * - Default deny: routes not in DEMO_ROUTE_RULES are admin-only.
 */
export function tokenAuthMiddleware(
  publicPaths: string[],
  demoToken?: string,
): MiddlewareHandler {
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

    // Admin token — full access
    const db = getDb();
    const row = db.prepare("SELECT value FROM config WHERE key = 'auth_token'").get() as { value: string } | undefined;
    if (row && row.value === token) {
      await next();
      return;
    }

    // Demo token — whitelist only
    if (demoToken && demoToken === token) {
      if (!isDemoRouteAllowed(c.req.method, c.req.path)) {
        throw new HttpError(403, 'Forbidden');
      }
      await next();
      return;
    }

    throw new HttpError(401, 'Unauthorized');
  };
}
