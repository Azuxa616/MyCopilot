import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../index.js';

describe('initDatabase', () => {
  let testDir: string;

  afterEach(() => {
    // Close the database if it was opened
    try {
      getDb().close();
    } catch {
      // db might not be initialized or already closed
    }
    // Clean up temp directory
    if (testDir) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // best effort cleanup
      }
    }
  });

  function setupDb(): void {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-test-'));
    initDatabase(testDir);
  }

  it('1. creates all 5 tables', () => {
    setupDb();
    const db = getDb();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toEqual([
      'config',
      'messages',
      'models',
      'providers',
      'sessions',
    ]);
  });

  it('2. config table has schema_version=1 after init', () => {
    setupDb();
    const db = getDb();
    const row = db
      .prepare("SELECT value FROM config WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    expect(row?.value).toBe('1');
  });

  it('3. PRAGMA journal_mode = wal', () => {
    setupDb();
    const db = getDb();
    const row = db.prepare('PRAGMA journal_mode').get() as {
      journal_mode: string;
    };
    // WAL mode returns 'wal' (lowercase) from the pragma
    expect(row.journal_mode).toBe('wal');
  });

  it('4. provider cascade delete → models deleted', () => {
    setupDb();
    const db = getDb();

    const now = Date.now();
    db.prepare(
      `INSERT INTO providers (id, name, type, base_url, api_key, enabled, created_at, updated_at)
       VALUES ('p1', 'Test', 'openai', 'https://api.openai.com', 'sk-test', 1, ?, ?)`,
    ).run(now, now);

    db.prepare(
      `INSERT INTO models (id, provider_id, name, enabled, created_at, updated_at)
       VALUES ('m1', 'p1', 'gpt-4', 1, ?, ?)`,
    ).run(now, now);

    // Verify both exist
    expect(
      db.prepare("SELECT id FROM providers WHERE id = 'p1'").get(),
    ).toBeTruthy();
    expect(
      db.prepare("SELECT id FROM models WHERE id = 'm1'").get(),
    ).toBeTruthy();

    // Delete provider → model should be cascade-deleted
    db.prepare("DELETE FROM providers WHERE id = 'p1'").run();

    expect(
      db.prepare("SELECT id FROM providers WHERE id = 'p1'").get(),
    ).toBeFalsy();
    expect(
      db.prepare("SELECT id FROM models WHERE id = 'm1'").get(),
    ).toBeFalsy();
  });

  it('5. session cascade delete → messages deleted', () => {
    setupDb();
    const db = getDb();

    const now = Date.now();
    db.prepare(
      `INSERT INTO sessions (id, title, created_at, updated_at)
       VALUES ('s1', 'Test', ?, ?)`,
    ).run(now, now);

    db.prepare(
      `INSERT INTO messages (id, session_id, role, content, status, created_at)
       VALUES ('msg1', 's1', 'user', 'Hello', 'sent', ?)`,
    ).run(now);

    // Verify both exist
    expect(
      db.prepare("SELECT id FROM sessions WHERE id = 's1'").get(),
    ).toBeTruthy();
    expect(
      db.prepare("SELECT id FROM messages WHERE id = 'msg1'").get(),
    ).toBeTruthy();

    // Delete session → message should be cascade-deleted
    db.prepare("DELETE FROM sessions WHERE id = 's1'").run();

    expect(
      db.prepare("SELECT id FROM sessions WHERE id = 's1'").get(),
    ).toBeFalsy();
    expect(
      db.prepare("SELECT id FROM messages WHERE id = 'msg1'").get(),
    ).toBeFalsy();
  });

  it('6. model delete → sessions.model_id SET NULL', () => {
    setupDb();
    const db = getDb();

    const now = Date.now();

    // Need a provider for the model FK
    db.prepare(
      `INSERT INTO providers (id, name, type, base_url, api_key, enabled, created_at, updated_at)
       VALUES ('p-setnull', 'Test', 'openai', 'https://api.openai.com', 'sk-test', 1, ?, ?)`,
    ).run(now, now);

    db.prepare(
      `INSERT INTO models (id, provider_id, name, enabled, created_at, updated_at)
       VALUES ('m-setnull', 'p-setnull', 'gpt-4', 1, ?, ?)`,
    ).run(now, now);

    db.prepare(
      `INSERT INTO sessions (id, title, model_id, created_at, updated_at)
       VALUES ('s-setnull', 'Test', 'm-setnull', ?, ?)`,
    ).run(now, now);

    // Verify session has model_id set
    const session = db
      .prepare("SELECT model_id FROM sessions WHERE id = 's-setnull'")
      .get() as { model_id: string } | undefined;
    expect(session?.model_id).toBe('m-setnull');

    // Delete the model
    db.prepare("DELETE FROM models WHERE id = 'm-setnull'").run();

    // Session should still exist but model_id should be NULL
    const sessionAfter = db
      .prepare("SELECT model_id FROM sessions WHERE id = 's-setnull'")
      .get() as { model_id: string | null } | undefined;
    expect(sessionAfter).toBeTruthy();
    expect(sessionAfter!.model_id).toBeNull();
  });

  it('7. CHECK constraint on messages.status rejects invalid status', () => {
    setupDb();
    const db = getDb();

    const now = Date.now();

    // Need a session for the FK
    db.prepare(
      `INSERT INTO sessions (id, title, created_at, updated_at)
       VALUES ('s-check', 'Test', ?, ?)`,
    ).run(now, now);

    // Insert with invalid status should throw
    expect(() =>
      db
        .prepare(
          `INSERT INTO messages (id, session_id, role, content, status, created_at)
           VALUES ('msg-check', 's-check', 'user', 'Hello', 'invalid_status', ?)`,
        )
        .run(now),
    ).toThrow();
  });

  it('8. CHECK constraint on providers.type rejects invalid type', () => {
    setupDb();
    const db = getDb();

    const now = Date.now();

    // Insert with invalid type should throw
    expect(() =>
      db
        .prepare(
          `INSERT INTO providers (id, name, type, base_url, api_key, enabled, created_at, updated_at)
           VALUES ('p-invalid', 'Test', 'anthropic', 'https://api.anthropic.com', '', 1, ?, ?)`,
        )
        .run(now, now),
    ).toThrow();
  });

  it('9. duplicate provider.id throws PRIMARY KEY constraint', () => {
    setupDb();
    const db = getDb();

    const now = Date.now();

    // First insert succeeds
    db.prepare(
      `INSERT INTO providers (id, name, type, base_url, api_key, enabled, created_at, updated_at)
       VALUES ('p-dup', 'Test', 'openai', 'https://api.openai.com', '', 1, ?, ?)`,
    ).run(now, now);

    // Second insert with same id should throw
    expect(() =>
      db
        .prepare(
          `INSERT INTO providers (id, name, type, base_url, api_key, enabled, created_at, updated_at)
           VALUES ('p-dup', 'Test2', 'ollama', 'http://localhost:11434', '', 1, ?, ?)`,
        )
        .run(now, now),
    ).toThrow();
  });
});
