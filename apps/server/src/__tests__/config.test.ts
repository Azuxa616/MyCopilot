import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(join(__dirname, '../db/schema.sql'), 'utf-8');

const TEST_DATA_DIR = resolve('.test-data-config');

function createTestDb(): InstanceType<typeof Database> {
  const dbPath = join(TEST_DATA_DIR, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function cleanupTestDb(db: InstanceType<typeof Database>) {
  try { db.close(); } catch { /* ignore */ }
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
}

// We import loadConfig dynamically to control env vars at test time
async function getLoadConfig() {
  const mod = await import('../config.js');
  return mod.loadConfig;
}

beforeEach(() => {
  // Clean state
  delete process.env.AUTH_TOKEN;
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  mkdirSync(TEST_DATA_DIR, { recursive: true });
});

afterAll(() => {
  delete process.env.AUTH_TOKEN;
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('loadConfig AUTH_TOKEN persistence', () => {
  it('Tier 1: AUTH_TOKEN env var set → used and written to config table', async () => {
    process.env.AUTH_TOKEN = 'env-provided-token';
    const db = createTestDb();
    const loadConfig = await getLoadConfig();

    const config = loadConfig(db);

    expect(config.authToken).toBe('env-provided-token');

    // Verify it was persisted to config table
    const row = db.prepare("SELECT value FROM config WHERE key = 'auth_token'").get() as { value: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.value).toBe('env-provided-token');

    cleanupTestDb(db);
  });

  it('Tier 2: no env var, config table has token → reads from config table', async () => {
    delete process.env.AUTH_TOKEN;
    const db = createTestDb();

    // Pre-populate config table with a token
    db.prepare("INSERT INTO config (key, value) VALUES ('auth_token', 'db-stored-token')").run();

    const loadConfig = await getLoadConfig();
    const config = loadConfig(db);

    expect(config.authToken).toBe('db-stored-token');

    cleanupTestDb(db);
  });

  it('Tier 3: no env var, no config entry → generates new token, writes to config table', async () => {
    delete process.env.AUTH_TOKEN;
    const db = createTestDb();
    // No auth_token in config table

    const loadConfig = await getLoadConfig();
    const config = loadConfig(db);

    // Should have generated a 64-char hex token
    expect(config.authToken).toMatch(/^[0-9a-f]{64}$/);

    // Verify it was persisted
    const row = db.prepare("SELECT value FROM config WHERE key = 'auth_token'").get() as { value: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.value).toBe(config.authToken);

    cleanupTestDb(db);
  });

  it('No db passed → generates temporary token (not persisted)', async () => {
    delete process.env.AUTH_TOKEN;

    const loadConfig = await getLoadConfig();
    const config = loadConfig(undefined);

    expect(config.authToken).toMatch(/^[0-9a-f]{64}$/);

    // No db, so nothing to verify persistence on
  });

  it('Restart test: token survives db close and reopen', async () => {
    delete process.env.AUTH_TOKEN;

    // First run: generate token and persist
    const db1 = createTestDb();
    const loadConfig1 = await getLoadConfig();
    const config1 = loadConfig1(db1);
    const token = config1.authToken;
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    // Close db (simulate shutdown)
    db1.close();

    // Reopen db (simulate restart)
    const db2 = createTestDb(); // same path, reopens the db
    const loadConfig2 = await getLoadConfig();
    const config2 = loadConfig2(db2);

    // Token should be the same
    expect(config2.authToken).toBe(token);

    cleanupTestDb(db2);
  });

  it('Env var overwrites previously stored token', async () => {
    // First, store a token
    delete process.env.AUTH_TOKEN;
    const db1 = createTestDb();
    const loadConfig1 = await getLoadConfig();
    const config1 = loadConfig1(db1);
    expect(config1.authToken).toMatch(/^[0-9a-f]{64}$/);
    db1.close();

    // Then restart with env var set
    process.env.AUTH_TOKEN = 'new-env-token';
    const db2 = createTestDb();
    const loadConfig2 = await getLoadConfig();
    const config2 = loadConfig2(db2);

    expect(config2.authToken).toBe('new-env-token');

    // Verify db was overwritten
    const row = db2.prepare("SELECT value FROM config WHERE key = 'auth_token'").get() as { value: string } | undefined;
    expect(row!.value).toBe('new-env-token');

    cleanupTestDb(db2);
  });
});
