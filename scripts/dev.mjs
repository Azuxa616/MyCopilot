#!/usr/bin/env node

/**
 * Sequential dev launcher: starts the server, waits for it to respond on
 * /api/health, then starts the web dev server.  Press Ctrl+C to kill both.
 *
 * Usage: node scripts/dev.mjs
 */

import { spawn } from 'node:child_process';

const HEALTH_URL = 'http://localhost:3000/api/health';
const MAX_WAIT_MS = 30_000;
const POLL_MS = 500;

async function waitForServer() {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return false;
}

function cleanup() {
  server.kill('SIGTERM');
  web.kill('SIGTERM');
  setTimeout(() => process.exit(0), 500);
}

// ── Start server ──
const server = spawn('pnpm', ['--filter', 'server', 'dev'], {
  stdio: 'inherit',
  shell: true,
  windowsHide: true,
});

// ── Wait for /api/health ──
console.log('[dev] Waiting for server to be ready...');
if (!(await waitForServer())) {
  console.error('[dev] Server did not start within 30 s — aborting.');
  server.kill();
  process.exit(1);
}
console.log('[dev] Server ready — starting web...');

// ── Start web ──
const web = spawn('pnpm', ['--filter', 'web', 'dev'], {
  stdio: 'inherit',
  shell: true,
  windowsHide: true,
});

// ── Signal forwarding ──
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// If either child exits, kill the other and exit with the same code.
server.on('exit', (code) => {
  console.log(`[dev] Server exited (${code ?? 0})`);
  web.kill();
  process.exit(code ?? 0);
});

web.on('exit', (code) => {
  console.log(`[dev] Web exited (${code ?? 0})`);
  server.kill();
  process.exit(code ?? 0);
});
