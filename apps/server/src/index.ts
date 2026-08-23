import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { loadConfig } from './config.js';
import { initDatabase } from './db/index.js';
import { corsMiddleware } from './middleware/cors.js';
import { loggerMiddleware } from './middleware/logger.js';
import { errorMiddleware } from './middleware/error.js';
import { tokenAuthMiddleware } from './middleware/tokenAuth.js';
import { getActiveStreamCount } from './streaming/registry.js';
import { healthApp } from './routes/health.js';
import { providersApp } from './routes/providers.js';
import { modelsApp } from './routes/models.js';
import { sessionsApp } from './routes/sessions.js';
import { messagesApp } from './routes/messages.js';
import { toolsApp } from './routes/tools.js';
import { createSkillsApp } from './routes/skills.js';
import { mcpsApp } from './routes/mcps.js';
import { pluginsApp } from './routes/plugins.js';
import { jobsApp } from './routes/jobs.js';
import { authApp } from './routes/auth.js';
import { debugRoutes } from './routes/debug.js';
import { listAllEnabledModels } from './repo/model.js';
import { registerTool } from './tools/registry.js';
import { builtinExecutors } from './tools/builtins/index.js';
import { syncDirectorySkills } from './skills/index.js';
import { disconnectAll, synchronizeAllEnabledMcps } from './mcp/index.js';
import { start as startJobWorker, stop as stopJobWorker, registerAgentLoopHandler } from './jobs/worker.js';
import { seedDemoData } from './demo/seed.js';

// Resolve dataDir first (needed for db init before full config load)
const dataDir = resolve(process.env.DATA_DIR || './data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const db = initDatabase(dataDir);
const config = loadConfig(db);

// Demo seeding — create the demo provider/model when DEMO_MODE=1 and the
// providers table is empty (idempotent; daily reset re-triggers it).
if (config.demoMode) {
  try {
    const result = seedDemoData();
    console.log(`[demo] seed: ${result.seeded ? 'created demo provider/model' : 'skipped (providers exist)'}`);
  } catch (err) {
    console.error('[demo] seed failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

// Skills directory — optional. When set, directory skills are synced into the
// DB at startup and the /api/skills/rescan endpoint scans it by default.
const skillsDir = process.env.SKILLS_DIR?.trim() || undefined;

const app = new Hono();

app.use('*', corsMiddleware(config.corsOrigin));
app.use('*', loggerMiddleware(config.logLevel));

app.onError(errorMiddleware());

// Health route — public, must be BEFORE tokenAuth
app.route('/api/health', healthApp);

// Token auth middleware — all /api/* routes except public paths.
// demoToken (from DEMO_TOKEN env via config) grants restricted demo-role access.
app.use('/api/*', tokenAuthMiddleware(['/api/health'], config.demoToken ?? undefined));

// API routes
app.route('/api/providers', providersApp);
app.route('/api/providers/:providerId/models', modelsApp);
app.route('/api/sessions', sessionsApp);
app.route('/api/sessions/:sessionId/messages', messagesApp);
app.route('/api/tools', toolsApp);
app.route('/api/skills', createSkillsApp({ skillsDir }));
app.route('/api/mcps', mcpsApp);
app.route('/api/plugins', pluginsApp);
app.route('/api/jobs', jobsApp);
app.route('/api/auth', authApp);

// Debug route — mounted ONLY when MYCOPILOT_DEBUG === '1' (explicit opt-in).
// Docker/prod never sets this flag, so the endpoint is fully absent (404),
// not 401/403, which avoids leaking that the endpoint exists. Auth still
// applies because this registration happens after the tokenAuthMiddleware.
if (process.env.MYCOPILOT_DEBUG === '1') {
  app.route('/api/debug', debugRoutes);
}

// List all enabled models (used by chat page dropdown)
app.get('/api/models', (c) => {
  const data = listAllEnabledModels();
  return c.json({ data });
});

// ─── Startup hooks ───
// Register built-in tool executors so they're available to the tool-calling
// loop. registerTool throws on double-registration (e.g. HMR in dev), so wrap
// each call defensively.
function registerBuiltInTools() {
  for (const { name, executor } of builtinExecutors) {
    try {
      registerTool(name, executor);
    } catch (err) {
      // Already registered (e.g. hot reload) — safe to ignore.
      console.warn(`[tools] ${name} already registered:`, err instanceof Error ? err.message : err);
    }
  }
}

registerBuiltInTools();

void synchronizeAllEnabledMcps().then(({ synchronized, failed }) => {
  console.log(`[mcp] startup tool sync: ${synchronized} synchronized, ${failed} failed`);
});

// Sync directory skills (create/update/delete) into the DB. Only runs when
// SKILLS_DIR is configured; missing directory is a no-op inside the scanner.
if (skillsDir) {
  try {
    const result = syncDirectorySkills(db, skillsDir);
    console.log(
      `[skills] directory sync complete: +${result.created} ~${result.updated} =${result.skipped} -${result.deleted}`,
    );
  } catch (err) {
    console.error('[skills] directory sync failed:', err);
  }
}

// Start the background job worker. Reclaims orphaned jobs from a previous
// crash on startup, then polls for new pending work every second. Stopped
// gracefully in `gracefulShutdown`.
// Register the agent-loop handler BEFORE starting the worker so the first
// poll cycle can dispatch any `agent-loop` job that was already queued.
registerAgentLoopHandler();
void startJobWorker();

// Static file serving — single-container mode
if (config.serverPublicDir && existsSync(config.serverPublicDir)) {
  app.get('*', async (c) => {
    const path = c.req.path;
    const filePath = `${config.serverPublicDir}${path === '/' ? '/index.html' : path}`;
    try {
      const file = await readFile(filePath);
      return c.body(file);
    } catch {
      return c.html(
        (await readFile(`${config.serverPublicDir}/index.html`)).toString('utf-8'),
      );
    }
  });
}

const server = serve(
  { fetch: app.fetch, port: config.port, hostname: '0.0.0.0' },
  (info) => {
    console.log(`Server running on http://${info.address}:${info.port}`);
  },
);

// Global timeout: disable for SSE long connections (Metis Q2 decision)
const httpServer = server as unknown as Server;
httpServer.requestTimeout = 0;
httpServer.headersTimeout = 0;

// Graceful shutdown: wait up to 5s for active SSE streams to finish
async function gracefulShutdown(signal: string) {
  console.log(`${signal} received, shutting down...`);
  // Stop the job worker first so it stops claiming/dispatching new jobs
  // and aborts the in-flight one before we tear down shared resources.
  try {
    await stopJobWorker();
  } catch (err) {
    console.error('[jobs] worker stop failed:', err);
  }
  const startWait = Date.now();
  while (getActiveStreamCount() > 0 && Date.now() - startWait < 5000) {
    await new Promise(r => setTimeout(r, 100));
  }
  // Close any live MCP subprocess / remote connections before exit.
  try {
    await disconnectAll();
  } catch {
    // best-effort
  }
  httpServer.close();
  db.close();
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
