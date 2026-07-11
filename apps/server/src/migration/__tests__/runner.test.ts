import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf-8');
const migrationsDir = join(__dirname, '..', 'sql');

function createDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

describe('runMigrations', () => {
  it('1. fresh install runs all migrations and records them', () => {
    const db = createDb();
    db.exec(schemaSql);
    runMigrations(db, migrationsDir);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    // Baseline tables preserved
    expect(tableNames).toContain('config');
    expect(tableNames).toContain('sessions');
    // Migration-created tables
    expect(tableNames).toContain('applied_migrations');
    expect(tableNames).toContain('tools');
    expect(tableNames).toContain('skills');
    expect(tableNames).toContain('mcps');
    expect(tableNames).toContain('agent_tools');
    expect(tableNames).toContain('agent_skills');
    expect(tableNames).toContain('agent_mcps');
    expect(tableNames).toContain('jobs');
    expect(tableNames).toContain('message_summaries');

    // applied_migrations has exactly 2 rows
    const row = db
      .prepare('SELECT COUNT(*) as count FROM applied_migrations')
      .get() as { count: number };
    expect(row.count).toBe(2);

    db.close();
  });

  it('2. Phase 1 upgrade preserves messages and adds new columns', () => {
    const db = createDb();
    db.exec(schemaSql);

    const now = Date.now();
    db.prepare(
      `INSERT INTO sessions (id, title, created_at, updated_at) VALUES ('s1', 'Test', ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO messages (id, session_id, role, content, status, created_at)
       VALUES ('m1', 's1', 'user', 'Hello', 'sent', ?)`,
    ).run(now);

    runMigrations(db, migrationsDir);

    // Old message preserved
    const count = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
    expect(count.count).toBe(1);

    const msg = db
      .prepare('SELECT id, role, content FROM messages WHERE id = ?')
      .get('m1') as { id: string; role: string; content: string };
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');

    // New columns exist
    const columns = db.prepare('PRAGMA table_info(messages)').all() as { name: string }[];
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('tool_calls');
    expect(colNames).toContain('tool_call_id');

    // role='tool' is now insertable
    db.prepare(
      `INSERT INTO messages (id, session_id, role, content, status, created_at)
       VALUES ('m2', 's1', 'tool', '{}', 'sent', ?)`,
    ).run(now);
    const toolMsg = db
      .prepare('SELECT role FROM messages WHERE id = ?')
      .get('m2') as { role: string };
    expect(toolMsg.role).toBe('tool');

    db.close();
  });

  it('3. running migrations twice is idempotent', () => {
    const db = createDb();
    db.exec(schemaSql);

    runMigrations(db, migrationsDir);
    runMigrations(db, migrationsDir);

    const row = db
      .prepare('SELECT COUNT(*) as count FROM applied_migrations')
      .get() as { count: number };
    expect(row.count).toBe(2);

    db.close();
  });

  it('4. broken migration rolls back and throws', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'migration-broken-'));
    writeFileSync(join(tmpDir, '9999_broken.sql'), 'SELECT FROM nonexistent_table;');

    const db = createDb();
    db.exec('CREATE TABLE applied_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');

    expect(() => runMigrations(db, tmpDir)).toThrow();

    const row = db
      .prepare('SELECT COUNT(*) as count FROM applied_migrations')
      .get() as { count: number };
    expect(row.count).toBe(0);

    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
