import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';

describe('migration 0006 skill files', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'migration-0006-'));
    initDatabase(testDir);
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch {
      // ignore
    }
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('creates skill_files table with expected columns', () => {
    const cols = getDb().prepare('PRAGMA table_info(skill_files)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(['id', 'skill_id', 'path', 'content', 'created_at', 'updated_at']),
    );
  });

  it('adds triggers column to skills with default []', () => {
    const cols = getDb().prepare('PRAGMA table_info(skills)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('triggers');

    getDb().prepare(
      "INSERT INTO skills (id, name, description, body, source, enabled, created_at, updated_at) VALUES ('s1', 'T', '', 'b', 'upload', 1, 1, 1)",
    ).run();
    const row = getDb().prepare("SELECT triggers FROM skills WHERE id = 's1'").get() as { triggers: string };
    expect(JSON.parse(row.triggers)).toEqual([]);
  });

  it('enforces unique (skill_id, path) and cascades skill deletion', () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO skills (id, name, description, body, source, enabled, created_at, updated_at) VALUES ('s1', 'T', '', 'b', 'upload', 1, 1, 1)",
    ).run();
    db.prepare(
      "INSERT INTO skill_files (id, skill_id, path, content, created_at, updated_at) VALUES ('f1', 's1', 'references/a.md', 'x', 1, 1)",
    ).run();

    let duplicateRejected = false;
    try {
      db.prepare(
        "INSERT INTO skill_files (id, skill_id, path, content, created_at, updated_at) VALUES ('f2', 's1', 'references/a.md', 'y', 1, 1)",
      ).run();
    } catch {
      duplicateRejected = true;
    }
    expect(duplicateRejected).toBe(true);

    db.prepare("DELETE FROM skills WHERE id = 's1'").run();
    const n = db.prepare('SELECT COUNT(*) as n FROM skill_files').get() as { n: number };
    expect(n.n).toBe(0);
  });
});