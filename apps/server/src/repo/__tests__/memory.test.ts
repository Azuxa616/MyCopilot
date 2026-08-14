import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import { createSession } from '../session.js';
import {
  createMemory,
  getMemory,
  listMemories,
  deleteMemory,
  searchMemories,
} from '../memory.js';

describe('MemoryRepo', () => {
  let testDir: string;
  let sessionId: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-test-'));
    initDatabase(testDir);
    sessionId = createSession({ title: 'Memory test' }).id;
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch {
      // ignore
    }
    if (testDir) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('createMemory persists a row and getMemory round-trips all fields', () => {
    const created = createMemory({
      sessionId,
      key: 'preference.lang',
      value: '用中文回复',
    });

    expect(created.id).toBeDefined();
    expect(created.sessionId).toBe(sessionId);
    expect(created.key).toBe('preference.lang');
    expect(created.value).toBe('用中文回复');
    expect(created.createdAt).toBe(created.updatedAt);

    const fetched = getMemory(sessionId, 'preference.lang');
    expect(fetched).toEqual(created);
  });

  it('createMemory upserts when (sessionId, key) already exists', () => {
    const first = createMemory({ sessionId, key: 'fact.city', value: 'Lives in Beijing' });

    // Pin an older timestamp so the later updatedAt assertion is deterministic
    // even when the clock has millisecond granularity.
    const db = getDb();
    db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(
      '2020-01-01T00:00:00.000Z',
      first.id,
    );

    const upserted = createMemory({ sessionId, key: 'fact.city', value: 'Moved to Shanghai' });

    // Same row: id and createdAt are preserved; value and updatedAt refreshed.
    expect(upserted.id).toBe(first.id);
    expect(upserted.createdAt).toBe(first.createdAt);
    expect(upserted.value).toBe('Moved to Shanghai');
    expect(upserted.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');

    // Still exactly one row for that key.
    expect(listMemories(sessionId)).toHaveLength(1);
  });

  it('listMemories returns rows ordered by key ascending', () => {
    createMemory({ sessionId, key: 'c-key', value: 'C' });
    createMemory({ sessionId, key: 'a-key', value: 'A' });
    createMemory({ sessionId, key: 'b-key', value: 'B' });

    const list = listMemories(sessionId);
    expect(list.map((m) => m.key)).toEqual(['a-key', 'b-key', 'c-key']);
  });

  it('deleteMemory removes the row and reports whether it existed', () => {
    createMemory({ sessionId, key: 'gone', value: 'bye' });

    expect(deleteMemory(sessionId, 'gone')).toBe(true);
    expect(getMemory(sessionId, 'gone')).toBeUndefined();
    // Second delete of the same key reports false.
    expect(deleteMemory(sessionId, 'gone')).toBe(false);
  });

  it('searchMemories matches key or value case-insensitively (ASCII)', () => {
    createMemory({ sessionId, key: 'preference.editor', value: 'prefers tabs' });
    createMemory({ sessionId, key: 'fact.city', value: 'Lives in BEIJING' });
    createMemory({ sessionId, key: 'other', value: 'unrelated' });

    // Hit via key.
    expect(searchMemories(sessionId, 'EDITOR').map((m) => m.key)).toEqual([
      'preference.editor',
    ]);
    // Hit via value, ASCII case-insensitive.
    expect(searchMemories(sessionId, 'beijing').map((m) => m.key)).toEqual(['fact.city']);
    // Multiple hits ordered by key.
    expect(searchMemories(sessionId, 'e').map((m) => m.key)).toEqual([
      'fact.city',
      'other',
      'preference.editor',
    ]);
    // Miss.
    expect(searchMemories(sessionId, 'no-such-token')).toEqual([]);
  });

  it('memories are isolated per session', () => {
    const otherSession = createSession({ title: 'Other' }).id;

    createMemory({ sessionId, key: 'shared-key', value: 'belongs to s1' });
    createMemory({ sessionId: otherSession, key: 'shared-key', value: 'belongs to s2' });

    // Same key in two sessions is allowed and never bleeds across.
    expect(getMemory(sessionId, 'shared-key')!.value).toBe('belongs to s1');
    expect(getMemory(otherSession, 'shared-key')!.value).toBe('belongs to s2');

    // s1's memory is invisible to s2 through list/search, and vice versa.
    expect(listMemories(sessionId)).toHaveLength(1);
    expect(listMemories(otherSession)).toHaveLength(1);
    expect(searchMemories(otherSession, 'belongs to s1')).toEqual([]);
    expect(searchMemories(sessionId, 'belongs to s2')).toEqual([]);

    // Deleting in s1 leaves s2 intact.
    deleteMemory(sessionId, 'shared-key');
    expect(getMemory(otherSession, 'shared-key')!.value).toBe('belongs to s2');
  });
});
