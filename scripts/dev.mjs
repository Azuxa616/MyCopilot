#!/usr/bin/env node

/**
 * Sequential dev launcher: starts the server, waits for it to respond on
 * /api/health, then starts the web dev server.  Press Ctrl+C to kill both.
 *
 * Usage: node scripts/dev.mjs
 *
 * Environment: the repo-root `.env` file is the single source of truth for
 * both server vars and VITE_* vars (see .env.example). It is loaded here and
 * injected into both children — values already exported in the shell win.
 * Relative PLUGINS_DIR / SKILLS_DIR values are resolved against the repo
 * root (NOT the server's cwd), so `.env` stays portable across machines.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = resolve(REPO_ROOT, '.env');
const HEALTH_URL = 'http://localhost:3000/api/health';
const MAX_WAIT_MS = 30_000;
const POLL_MS = 500;

/**
 * Minimal .env parser: KEY=VALUE lines, `#` comments, blank lines, optional
 * single/double quotes. Returns a Map; malformed lines are skipped silently.
 */
function parseEnvFile(text) {
  const result = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result.set(key, value);
  }
  return result;
}

// Load root .env with shell-priority: only fill keys not already in process.env.
if (existsSync(ENV_FILE)) {
  for (const [key, value] of parseEnvFile(readFileSync(ENV_FILE, 'utf-8'))) {
    if (process.env[key] === undefined && value !== '') {
      process.env[key] = value;
    }
  }
  console.log('[dev] Loaded .env from repo root');
} else {
  console.log('[dev] No .env found at repo root (see .env.example) — using shell env only');
}

// Path vars in the unified .env are repo-root-relative; anchor them before the
// server child (whose cwd is apps/server) sees them. Absolute values pass through.
for (const key of ['PLUGINS_DIR', 'SKILLS_DIR']) {
  const raw = process.env[key];
  if (raw && !isAbsolute(raw)) {
    process.env[key] = resolve(REPO_ROOT, raw);
  }
}

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
// MYCOPILOT_DEBUG enables the /api/debug endpoint for local dev. Docker/prod
// never sets this flag, so the endpoint stays absent in production.
// MYCOPILOT_E2E_TOOLS enables the e2e_danger_tool / e2e_restricted_tool
// built-in fixtures so the chat UI can exercise the danger/restricted
// confirmation flows without an external MCP server. Also dev-only.
const server = spawn('pnpm', ['--filter', 'server', 'dev'], {
  stdio: 'inherit',
  shell: true,
  windowsHide: true,
  env: { ...process.env, MYCOPILOT_DEBUG: '1', MYCOPILOT_E2E_TOOLS: '1' },
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
// Vite reads VITE_* vars from the repo-root .env itself (envDir in
// vite.config.ts), so no per-var injection is needed here.
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
