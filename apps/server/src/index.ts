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
import { listAllEnabledModels } from './repo/model.js';

// Resolve dataDir first (needed for db init before full config load)
const dataDir = resolve(process.env.DATA_DIR || './data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const db = initDatabase(dataDir);
const config = loadConfig(db);

const app = new Hono();

app.use('*', corsMiddleware(config.corsOrigin));
app.use('*', loggerMiddleware(config.logLevel));

app.onError(errorMiddleware());

// Health route — public, must be BEFORE tokenAuth
app.route('/api/health', healthApp);

// Token auth middleware — all /api/* routes except public paths
app.use('/api/*', tokenAuthMiddleware(['/api/health']));

// API routes
app.route('/api/providers', providersApp);
app.route('/api/providers/:providerId/models', modelsApp);
app.route('/api/sessions', sessionsApp);
app.route('/api/sessions/:sessionId/messages', messagesApp);

// List all enabled models (used by chat page dropdown)
app.get('/api/models', (c) => {
  const data = listAllEnabledModels();
  return c.json({ data });
});

// Static file serving — single-container mode
if (config.serverPublicDir && existsSync(config.serverPublicDir)) {
  app.get('*', async (c) => {
    const path = c.req.path;
    const filePath = `${config.serverPublicDir}${path === '/' ? '/index.html' : path}`;
    try {
      const file = await readFile(filePath);
      return c.body(file);
    } catch {
      return c.html(await readFile(`${config.serverPublicDir}/index.html`));
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
  const startWait = Date.now();
  while (getActiveStreamCount() > 0 && Date.now() - startWait < 5000) {
    await new Promise(r => setTimeout(r, 100));
  }
  httpServer.close();
  db.close();
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
