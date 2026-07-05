import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface ServerConfig {
  authToken: string;
  dataDir: string;
  port: number;
  corsOrigin: string[];
  serverPublicDir: string | null;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxAttachmentSizeMb: number;
}

export function loadConfig(db?: InstanceType<typeof Database>): ServerConfig {
  // AUTH_TOKEN resolution (3-tier: env → config table → generate)
  // Guarantees restart preserves token (Metis Q1 decision)
  let authToken: string;
  const envToken = process.env.AUTH_TOKEN;

  if (envToken) {
    // Tier 1: env var set → use it, persist to config table, print to stdout
    authToken = envToken;
    if (db) {
      db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('auth_token', ?)").run(authToken);
    }
    console.log(`AUTH_TOKEN: using from environment (persisted to config)`);
  } else if (db) {
    // Tier 2: read from config table
    const row = db
      .prepare("SELECT value FROM config WHERE key = 'auth_token'")
      .get() as { value: string } | undefined;
    if (row) {
      authToken = row.value;
      console.log(`AUTH_TOKEN: loaded from config table (token: ${authToken})`);
    } else {
      // Tier 3: generate new, persist to config table, print to stdout
      authToken = randomBytes(32).toString('hex');
      db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('auth_token', ?)").run(authToken);
      console.log(`Generated AUTH_TOKEN: ${authToken}`);
    }
  } else {
    // No db available → generate in-memory (temporary, survives only this process)
    authToken = randomBytes(32).toString('hex');
    console.log(`Generated AUTH_TOKEN (temporary, no DB): ${authToken}`);
  }

  // PORT — must be a valid number
  const portStr = process.env.PORT || '3000';
  const port = Number(portStr);
  if (!Number.isFinite(port)) {
    throw new Error(`Invalid PORT: ${portStr}`);
  }

  // DATA_DIR — ensure directory exists
  const dataDirRaw = process.env.DATA_DIR || './data';
  const dataDir = resolve(dataDirRaw);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // CORS_ORIGIN — comma-separated origins
  const corsStr = process.env.CORS_ORIGIN || 'http://localhost:5173';
  const corsOrigin = corsStr.split(',').map(s => s.trim()).filter(Boolean);

  // SERVER_PUBLIC_DIR — null when empty / unset
  const serverPublicDir = process.env.SERVER_PUBLIC_DIR?.trim() || null;

  // LOG_LEVEL — default to 'info'
  const logLevelRaw = process.env.LOG_LEVEL || 'info';
  const validLogLevels: ServerConfig['logLevel'][] = ['debug', 'info', 'warn', 'error'];
  const logLevel = validLogLevels.includes(logLevelRaw as ServerConfig['logLevel'])
    ? (logLevelRaw as ServerConfig['logLevel'])
    : 'info';

  // MAX_ATTACHMENT_SIZE_MB — default 10
  const maxAttachmentSizeMb = Number(process.env.MAX_ATTACHMENT_SIZE_MB) || 10;

  return {
    authToken,
    dataDir,
    port,
    corsOrigin,
    serverPublicDir,
    logLevel,
    maxAttachmentSizeMb,
  };
}
