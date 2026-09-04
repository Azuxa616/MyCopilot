import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import { createPluginStore } from '../store.js';
import { assertNoNamespaceConflict, NAMESPACE_CONFLICT } from '../namespace.js';

/** 直接写 plugins 表的最小行（绕开 createPlugin 的完整清单要求）。 */
function insertPluginRow(id: string, state: string): void {
  getDb()
    .prepare(
      `INSERT INTO plugins (id, version, source, state, manifest, directory, created_at, updated_at)
       VALUES (?, '1.0.0', 'community', ?, '{}', ?, 0, 0)`,
    )
    .run(id, state, `plugins/${id}`);
}

/** 直接写 mcps 表（id 必须唯一，name 承载全限定名）。 */
function insertMcpRow(id: string, name: string, pluginId: string): void {
  getDb()
    .prepare(
      `INSERT INTO mcps (id, name, description, transport, source_plugin_id, created_at, updated_at)
       VALUES (?, ?, 'test', 'stdio', ?, 0, 0)`,
    )
    .run(id, name, pluginId);
}

/** 直接写 skills 表（source='plugin'，见迁移 0005 的 CHECK）。 */
function insertSkillRow(id: string, name: string, pluginId: string): void {
  getDb()
    .prepare(
      `INSERT INTO skills (id, name, description, source, source_plugin_id, created_at, updated_at)
       VALUES (?, ?, 'test', 'plugin', ?, 0, 0)`,
    )
    .run(id, name, pluginId);
}

describe('plugin store & namespace', () => {
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

  describe('createPluginStore', () => {
    it('store 是跨插件隔离的：storeB 读不到 storeA 写入的键', async () => {
      const storeA = createPluginStore('plugin-a');
      const storeB = createPluginStore('plugin-b');

      await storeA.set('k', 'v');

      expect(await storeA.get('k')).toBe('v');
      expect(await storeB.get('k')).toBeUndefined();
    });

    it('set/get 对结构化值做 JSON 往返（深等）', async () => {
      const store = createPluginStore('plugin-a');

      await store.set('obj', { a: 1, b: 'x' });

      expect(await store.get('obj')).toEqual({ a: 1, b: 'x' });
    });

    it('损坏的 JSON：get 返回 undefined 且不抛出', async () => {
      const store = createPluginStore('plugin-a');
      getDb()
        .prepare(
          `INSERT INTO plugin_data (plugin_id, key, value, created_at, updated_at)
           VALUES (?, ?, '{not json', 0, 0)`,
        )
        .run('plugin-a', 'bad');

      const value = await store.get('bad');

      expect(value).toBeUndefined();
    });

    it('delete/list 基本路径', async () => {
      const store = createPluginStore('plugin-a');

      await store.set('b-key', 1);
      await store.set('a-key', 2);
      expect(await store.list()).toEqual(['a-key', 'b-key']);

      await store.delete('a-key');
      expect(await store.list()).toEqual(['b-key']);
      expect(await store.get('a-key')).toBeUndefined();
    });
  });

  describe('assertNoNamespaceConflict', () => {
    it('正常场景：前缀机制下不同插件的全限定名不同，不抛', () => {
      insertPluginRow('plugin-a', 'enabled');
      insertPluginRow('plugin-b', 'installed');
      insertMcpRow('mcp-a', 'plugin-a:server1', 'plugin-a');
      insertMcpRow('mcp-b', 'plugin-b:server1', 'plugin-b');

      expect(() => assertNoNamespaceConflict('plugin-b')).not.toThrow();
    });

    it('对方插件未 enabled 时，同名资源不构成冲突', () => {
      insertPluginRow('plugin-a', 'disabled');
      insertPluginRow('plugin-b', 'installed');
      insertMcpRow('mcp-a', 'shared-name', 'plugin-a');
      insertMcpRow('mcp-b', 'shared-name', 'plugin-b');

      expect(() => assertNoNamespaceConflict('plugin-b')).not.toThrow();
    });

    it('冲突场景：与其他 enabled 插件同全限定名 → 抛错含 namespace_conflict 与资源名', () => {
      // 直接 SQL 构造两行同全限定名 mcps（模拟未来无前缀场景）
      insertPluginRow('plugin-a', 'enabled');
      insertPluginRow('plugin-b', 'installed');
      insertMcpRow('mcp-a', 'shared-mcp', 'plugin-a');
      insertMcpRow('mcp-b', 'shared-mcp', 'plugin-b');

      expect(() => assertNoNamespaceConflict('plugin-b')).toThrow(
        NAMESPACE_CONFLICT,
      );
      expect(() => assertNoNamespaceConflict('plugin-b')).toThrow(/shared-mcp/);
    });

    it('skills 表的冲突同样被检出', () => {
      insertPluginRow('plugin-a', 'enabled');
      insertPluginRow('plugin-b', 'installed');
      insertSkillRow('skill-a', 'shared-skill', 'plugin-a');
      insertSkillRow('skill-b', 'shared-skill', 'plugin-b');

      expect(() => assertNoNamespaceConflict('plugin-b')).toThrow(
        NAMESPACE_CONFLICT,
      );
      expect(() => assertNoNamespaceConflict('plugin-b')).toThrow(/shared-skill/);
    });
  });
});
