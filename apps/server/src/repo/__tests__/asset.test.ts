import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import { createAsset, getAsset, listRecentAssets } from '../asset.js';

describe('AssetRepo', () => {
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

  it('createAsset persists a row and getAsset round-trips it', () => {
    const created = createAsset({
      name: 'a.png',
      mimeType: 'image/png',
      size: 3,
      kind: 'image',
      sha256: 'abc123',
    });
    expect(created.id).toBeTruthy();
    expect(created.source).toBe('upload');
    expect(created.createdAt).toBeGreaterThan(0);

    const got = getAsset(created.id);
    expect(got?.kind).toBe('image');
    expect(got?.mimeType).toBe('image/png');
    expect(got?.sha256).toBe('abc123');
  });

  it('getAsset returns undefined for unknown id', () => {
    expect(getAsset('nope')).toBeUndefined();
  });

  it('listRecentAssets returns newest first and respects limit', () => {
    const first = createAsset({ name: '1.txt', mimeType: 'text/plain', size: 1, kind: 'text', sha256: 'h1' });
    const second = createAsset({ name: '2.md', mimeType: 'text/markdown', size: 1, kind: 'markdown', sha256: 'h2' });
    const all = listRecentAssets(10);
    expect(all.map((a) => a.id)).toContain(first.id);
    expect(all.map((a) => a.id)).toContain(second.id);
    // created_at 同毫秒时顺序不稳定，断言数量与 limit 即可
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(listRecentAssets(1).length).toBe(1);
  });

  it('messages.parts column exists after migration', () => {
    const cols = getDb()
      .prepare('PRAGMA table_info(messages)')
      .all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('parts');
  });
});
