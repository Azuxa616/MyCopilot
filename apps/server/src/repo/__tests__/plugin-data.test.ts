import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import {
  getData,
  setData,
  deleteData,
  deleteAllData,
  listKeys,
} from '../plugin-data.js';

describe('PluginDataRepo', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-test-'));
    initDatabase(testDir);
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

  it('setData persists a row and getData round-trips the value', () => {
    setData('plugin-a', 'greeting', JSON.stringify({ lang: 'zh' }));

    expect(getData('plugin-a', 'greeting')).toBe(JSON.stringify({ lang: 'zh' }));
    // Missing key (or untouched plugin) reads as undefined.
    expect(getData('plugin-a', 'no-such-key')).toBeUndefined();
    expect(getData('plugin-never', 'greeting')).toBeUndefined();
  });

  it('setData upserts when (pluginId, key) already exists', () => {
    setData('plugin-a', 'counter', '1');
    setData('plugin-a', 'counter', '2');

    expect(getData('plugin-a', 'counter')).toBe('2');

    const db = getDb();
    const rows = db
      .prepare('SELECT plugin_id, key, created_at, updated_at FROM plugin_data')
      .all() as { created_at: number; updated_at: number }[];
    expect(rows).toHaveLength(1);
    // Upsert refreshes updated_at (pinned older created_at makes it visible).
    expect(rows[0].updated_at).toBeGreaterThanOrEqual(rows[0].created_at);
  });

  it('data is isolated per plugin: a key set by plugin-a is invisible to plugin-b', () => {
    setData('plugin-a', 'shared-key', 'belongs to a');
    setData('plugin-b', 'shared-key', 'belongs to b');

    expect(getData('plugin-a', 'shared-key')).toBe('belongs to a');
    expect(getData('plugin-b', 'shared-key')).toBe('belongs to b');

    // Deleting in plugin-a leaves plugin-b intact.
    expect(deleteData('plugin-a', 'shared-key')).toBe(true);
    expect(getData('plugin-a', 'shared-key')).toBeUndefined();
    expect(getData('plugin-b', 'shared-key')).toBe('belongs to b');
    expect(deleteData('plugin-a', 'shared-key')).toBe(false);
  });

  it('listKeys returns only the owning plugin keys, ordered ascending', () => {
    setData('plugin-a', 'c-key', 'C');
    setData('plugin-a', 'a-key', 'A');
    setData('plugin-a', 'b-key', 'B');
    setData('plugin-b', 'z-key', 'Z');

    expect(listKeys('plugin-a')).toEqual(['a-key', 'b-key', 'c-key']);
    expect(listKeys('plugin-b')).toEqual(['z-key']);
    expect(listKeys('plugin-never')).toEqual([]);
  });

  it('deleteAllData wipes every key of the plugin and only that plugin', () => {
    setData('plugin-a', 'k1', 'v1');
    setData('plugin-a', 'k2', 'v2');
    setData('plugin-b', 'keep', 'mine');

    expect(deleteAllData('plugin-a')).toBe(2);
    expect(listKeys('plugin-a')).toEqual([]);
    expect(getData('plugin-a', 'k1')).toBeUndefined();

    // Other plugins untouched.
    expect(listKeys('plugin-b')).toEqual(['keep']);
    expect(deleteAllData('plugin-a')).toBe(0);
  });
});
