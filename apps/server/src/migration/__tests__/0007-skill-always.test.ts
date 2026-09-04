import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';

describe('migration 0007 skill always', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'migration-0007-'));
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

  it('adds always column to skills with default 0', () => {
    const cols = getDb().prepare('PRAGMA table_info(skills)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('always');

    getDb().prepare(
      "INSERT INTO skills (id, name, description, body, source, enabled, created_at, updated_at) VALUES ('s1', 'T', '', 'b', 'upload', 1, 1, 1)",
    ).run();
    const row = getDb().prepare("SELECT always FROM skills WHERE id = 's1'").get() as { always: number };
    expect(row.always).toBe(0);
  });
});