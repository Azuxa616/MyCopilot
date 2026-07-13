import { basename, resolve } from 'node:path';
import { Hono } from 'hono';

// TODO(T1): once packages/shared/src/debug.ts exports DebugEnvInfo, import it
// from '@my-copilot/shared' instead of declaring inline. The inline shape
// mirrors the planned type exactly so the swap is a no-op for consumers.
export interface DebugEnvInfo {
  nodeVersion: string;
  platform: string;
  arch: string;
  uptime: number;
  dbPath: string;
  nodeEnv: string;
}

/**
 * Debug sub-app. Mounted at `/api/debug` ONLY when `MYCOPILOT_DEBUG === '1'`
 * (see apps/server/src/index.ts). Auth is enforced by the shared
 * `tokenAuthMiddleware` registered in index.ts — this route never runs in
 * prod/Docker because the flag is never set there.
 *
 * Safety: never return AUTH_TOKEN, CORS_ORIGIN, process.env dump, absolute
 * paths, stack traces, or process.argv. dbPath is basename-only on purpose.
 */
export const debugRoutes = new Hono();

debugRoutes.get('/', (c) => {
  // Resolve the same way index.ts does, then keep only the directory name so
  // no user/path segment (e.g. "C:\Users\...") can leak.
  const dataDir = resolve(process.env.DATA_DIR || './data');
  const body: DebugEnvInfo = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    uptime: Math.floor(process.uptime()),
    dbPath: `${basename(dataDir)}/mycopilot.db`,
    nodeEnv: process.env.NODE_ENV ?? 'unset',
  };
  return c.json(body);
});
