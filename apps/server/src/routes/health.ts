import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { getDb } from '../db/index.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));

export const healthApp = new Hono();

healthApp.get('/', (c) => {
  let db: 'connected' | 'error' = 'connected';
  try {
    getDb().prepare('SELECT 1').get();
  } catch {
    db = 'error';
  }

  return c.json({
    status: 'ok',
    db,
    version: pkg.version,
    uptime: process.uptime(),
  });
});
