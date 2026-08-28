import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';

describe('migration 0010 message reasoning', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'migration-0010-'));
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

  it('adds a nullable, default-less reasoning column to messages', () => {
    const cols = getDb().prepare('PRAGMA table_info(messages)').all() as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const reasoning = cols.find((c) => c.name === 'reasoning');
    expect(reasoning).toBeDefined();
    // SQLite ADD COLUMN 无默认：旧数据 NULL，新插入不指定也为 NULL。
    expect(reasoning!.notnull).toBe(0);
    expect(reasoning!.dflt_value).toBeNull();
  });

  it('rows inserted without reasoning (旧数据形状) stay NULL', () => {
    getDb()
      .prepare("INSERT INTO sessions (id, title, created_at, updated_at) VALUES ('s1', 'T', 1, 1)")
      .run();
    getDb()
      .prepare(
        "INSERT INTO messages (id, session_id, role, content, status, created_at) VALUES ('m1', 's1', 'user', 'hi', 'sent', 1)",
      )
      .run();

    const row = getDb()
      .prepare('SELECT reasoning FROM messages WHERE id = ?')
      .get('m1') as { reasoning: string | null };
    expect(row.reasoning).toBeNull();
  });

  it('stores and reads back reasoning text (非 JSON 直存)', () => {
    getDb()
      .prepare("INSERT INTO sessions (id, title, created_at, updated_at) VALUES ('s1', 'T', 1, 1)")
      .run();
    getDb()
      .prepare(
        "INSERT INTO messages (id, session_id, role, content, reasoning, status, created_at) VALUES ('m1', 's1', 'assistant', '答案', '先分析再回答', 'sent', 1)",
      )
      .run();

    const row = getDb()
      .prepare('SELECT reasoning FROM messages WHERE id = ?')
      .get('m1') as { reasoning: string | null };
    expect(row.reasoning).toBe('先分析再回答');
  });

  it('is idempotent: re-running initDatabase does not re-apply or fail', () => {
    expect(() => initDatabase(testDir)).not.toThrow();

    const cols = getDb().prepare('PRAGMA table_info(messages)').all() as Array<{
      name: string;
    }>;
    expect(cols.filter((c) => c.name === 'reasoning')).toHaveLength(1);
  });
});
