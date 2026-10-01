import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import { createProvider } from '../../repo/provider.js';
import { createModel } from '../../repo/model.js';

describe('migration 0009 model capabilities', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'migration-0009-'));
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

  it('adds capabilities column to models with JSON default {}', () => {
    const cols = getDb().prepare('PRAGMA table_info(models)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('capabilities');

    const provider = createProvider({
      name: 'T',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: '',
    });
    createModel(provider.id, { name: 'gpt-4o' });
    const row = getDb()
      .prepare("SELECT capabilities FROM models WHERE name = 'gpt-4o'")
      .get() as { capabilities: string };
    expect(row.capabilities).toBe('{}'); // 存量语义：空对象 = 全 unknown
  });
});
