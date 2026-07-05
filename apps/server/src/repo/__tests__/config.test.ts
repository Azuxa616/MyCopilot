import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import { get, set } from '../config.js';

describe('ConfigRepo', () => {
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

  it('set then get returns the value', () => {
    set('test_key', 'test_value');
    expect(get('test_key')).toBe('test_value');
  });

  it('get returns undefined for non-existent key', () => {
    expect(get('non_existent')).toBeUndefined();
  });

  it('set updates existing key', () => {
    set('update_key', 'original');
    expect(get('update_key')).toBe('original');

    set('update_key', 'updated');
    expect(get('update_key')).toBe('updated');
  });
});
