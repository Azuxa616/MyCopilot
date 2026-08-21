/**
 * loader 生命周期状态机集成测试（插件系统 T4）。
 *
 * 真实链路：mkdtemp 临时 PLUGINS_DIR + fixture plugin.json/skills 文件 +
 * initDatabase 临时 SQLite 库，不 mock validate/repo；capabilities 经
 * setCapabilities 注入 stub（默认 noop，afterEach 复位防泄漏）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { PluginManifest } from '@my-copilot/shared';
import { initDatabase, getDb } from '../../db/index.js';
import { getPlugin } from '../../repo/plugin.js';
import { setCapabilities } from '../loader.js';
import { noopCapabilities } from '../capabilities.js';
import {
  HOST_VERSION,
  compareSemver,
  getPluginsDir,
  installFromDirectory,
  enablePlugin,
  disablePlugin,
  uninstallPlugin,
} from '../loader.js';

interface EventRow {
  plugin_id: string;
  from_state: string | null;
  to_state: string;
  type: string;
  trigger: string;
  version: string;
  result: string;
  payload: string | null;
}

/** 按 rowid（插入顺序）取事件行，避免同毫秒时间戳下 created_at 排序不稳定。 */
function eventsFor(pluginId: string): EventRow[] {
  return getDb()
    .prepare('SELECT * FROM plugin_lifecycle_events WHERE plugin_id = ? ORDER BY rowid')
    .all(pluginId) as EventRow[];
}

function countRows(table: string): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

const originalPluginsDir = process.env.PLUGINS_DIR;

describe('PluginLoader 基础单元', () => {
  it('HOST_VERSION 与 apps/server/package.json 的 version 一致', () => {
    expect(HOST_VERSION).toBe('0.1.0');
  });

  it('compareSemver 按数字三元组比较', () => {
    expect(compareSemver('0.1.0', '0.1.0')).toBe(0);
    expect(compareSemver('0.2.0', '0.1.0')).toBe(1);
    expect(compareSemver('0.1.0', '0.2.0')).toBe(-1);
    expect(compareSemver('1.0.0', '0.99.99')).toBe(1);
    expect(compareSemver('0.1.10', '0.1.9')).toBe(1);
  });

  it('getPluginsDir：未设置/空白返回 undefined，否则返回 trim 后的值', () => {
    delete process.env.PLUGINS_DIR;
    expect(getPluginsDir()).toBeUndefined();
    process.env.PLUGINS_DIR = '   ';
    expect(getPluginsDir()).toBeUndefined();
    process.env.PLUGINS_DIR = ' C:\\plugins ';
    expect(getPluginsDir()).toBe('C:\\plugins');
  });
});

describe('PluginLoader 生命周期', () => {
  let testDir: string;
  let pluginsDir: string;

  function baseManifest(name: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
      version: '1.2.3',
      description: 'A test plugin',
      author: { name: 'Tester' },
      license: 'MIT',
      engineCompatibility: { minVersion: '0.1.0' },
      source: 'community',
      permissions: {},
      provides: { skills: [{ path: 'skills/greet.md' }] },
      ...overrides,
      name,
    };
  }

  /** 在 PLUGINS_DIR 下写一个插件目录（plugin.json + skills/greet.md），返回 plugin.json 原文。 */
  function writePlugin(dirName: string, manifest: object, raw?: string): string {
    const pluginDir = join(pluginsDir, dirName);
    mkdirSync(join(pluginDir, 'skills'), { recursive: true });
    const content = raw ?? JSON.stringify(manifest);
    writeFileSync(join(pluginDir, 'plugin.json'), content);
    writeFileSync(join(pluginDir, 'skills', 'greet.md'), '# greet\n');
    return content;
  }

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-loader-test-'));
    initDatabase(testDir);
    pluginsDir = join(testDir, 'plugins');
    process.env.PLUGINS_DIR = pluginsDir;
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
    if (originalPluginsDir === undefined) {
      delete process.env.PLUGINS_DIR;
    } else {
      process.env.PLUGINS_DIR = originalPluginsDir;
    }
    setCapabilities(noopCapabilities);
  });

  it('install 全路径：discovered→downloaded→verified→installed，4 条事件字段齐全', () => {
    writePlugin('demo-plugin', baseManifest('demo-plugin'));

    const record = installFromDirectory('demo-plugin');

    expect(record.id).toBe('demo-plugin');
    expect(record.state).toBe('installed');
    expect(record.source).toBe('community');
    expect(record.version).toBe('1.2.3');

    const rows = eventsFor('demo-plugin');
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.to_state)).toEqual(['discovered', 'downloaded', 'verified', 'installed']);
    expect(rows.map((r) => r.type)).toEqual(['discovered', 'downloaded', 'verified', 'installed']);
    expect(rows.map((r) => r.from_state)).toEqual([null, 'discovered', 'downloaded', 'verified']);
    expect(rows.every((r) => r.version === '1.2.3')).toBe(true);
    expect(rows.every((r) => r.trigger === 'system')).toBe(true);
    expect(rows.map((r) => JSON.parse(r.result))).toEqual([
      { status: 'success' },
      { status: 'success' },
      { status: 'success' },
      { status: 'success' },
    ]);
    expect((JSON.parse(rows[2].payload!) as { digest: string }).digest).toBe(record.digest);
  });

  it('community 禁止 enable；official enable 成功并记 user 事件', () => {
    writePlugin('demo-plugin', baseManifest('demo-plugin'));
    installFromDirectory('demo-plugin');
    expect(() => enablePlugin('demo-plugin')).toThrow('community_enable_forbidden');
    expect(getPlugin('demo-plugin')!.state).toBe('installed');

    writePlugin('official-plugin', baseManifest('official-plugin', { source: 'official' }));
    installFromDirectory('official-plugin');
    const enabled = enablePlugin('official-plugin');
    expect(enabled.state).toBe('enabled');

    const rows = eventsFor('official-plugin');
    const enableRow = rows[rows.length - 1];
    expect(enableRow.type).toBe('enabled');
    expect(enableRow.from_state).toBe('installed');
    expect(enableRow.to_state).toBe('enabled');
    expect(enableRow.trigger).toBe('user');
    expect(JSON.parse(enableRow.result)).toEqual({ status: 'success' });
  });

  it('official 禁止 uninstall；community uninstall 隐式 disable 并清空关联行', () => {
    writePlugin('official-plugin', baseManifest('official-plugin', { source: 'official' }));
    installFromDirectory('official-plugin');
    expect(() => uninstallPlugin('official-plugin')).toThrow('official_uninstall_forbidden');
    expect(getPlugin('official-plugin')!.state).toBe('installed');

    writePlugin('demo-plugin', baseManifest('demo-plugin'));
    installFromDirectory('demo-plugin');
    const db = getDb();
    // community 无法走 enable 入口，直接 SQL 造 enabled 态（模拟市场安装后的状态）
    db.prepare("UPDATE plugins SET state = 'enabled' WHERE id = 'demo-plugin'").run();
    const ts = 0;
    db.prepare(
      `INSERT INTO mcps (id, name, description, transport, args, env, enabled, created_at, updated_at, source_plugin_id)
       VALUES ('mcp-1', 'plugin-mcp', 'from plugin', 'stdio', '[]', '{}', 1, ?, ?, 'demo-plugin')`,
    ).run(ts, ts);
    db.prepare(
      `INSERT INTO mcps (id, name, description, transport, args, env, enabled, created_at, updated_at, source_plugin_id)
       VALUES ('mcp-2', 'other-mcp', 'other plugin', 'stdio', '[]', '{}', 1, ?, ?, 'another-plugin')`,
    ).run(ts, ts);
    db.prepare(
      `INSERT INTO skills (id, name, description, body, source, enabled, created_at, updated_at, source_plugin_id)
       VALUES ('sk-1', 'plugin-skill', 'from plugin', 'body', 'plugin', 1, ?, ?, 'demo-plugin')`,
    ).run(ts, ts);
    db.prepare(
      `INSERT INTO plugin_data (plugin_id, key, value, created_at, updated_at)
       VALUES ('demo-plugin', 'k', 'v', 0, 0)`,
    ).run();

    const result = uninstallPlugin('demo-plugin');

    expect(result.state).toBe('uninstalled');
    const remainingMcps = db.prepare('SELECT id FROM mcps').all() as { id: string }[];
    expect(remainingMcps.map((r) => r.id)).toEqual(['mcp-2']);
    expect((db.prepare('SELECT COUNT(*) AS n FROM skills').get() as { n: number }).n).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM plugin_data WHERE plugin_id = 'demo-plugin'").get() as { n: number }).n,
    ).toBe(0);

    const rows = eventsFor('demo-plugin');
    expect(rows.map((r) => r.to_state)).toEqual([
      'discovered',
      'downloaded',
      'verified',
      'installed',
      'disabled',
      'uninstalled',
    ]);
    expect(rows[4].from_state).toBe('enabled');
    expect(rows[4].trigger).toBe('user');
    expect(rows[5].from_state).toBe('disabled');
    expect(rows[5].type).toBe('uninstalled');
    expect(rows[5].trigger).toBe('user');
    expect(JSON.parse(rows[5].result)).toEqual({ status: 'success' });
  });

  it('不存在的 id、非法源状态与重复 install 均拒绝且不产生副作用', () => {
    expect(() => enablePlugin('nope')).toThrow('plugin_not_found');
    expect(() => disablePlugin('nope')).toThrow('plugin_not_found');
    expect(() => uninstallPlugin('nope')).toThrow('plugin_not_found');

    writePlugin('demo-plugin', baseManifest('demo-plugin'));
    installFromDirectory('demo-plugin');

    // disable 仅允许从 enabled 出发
    expect(() => disablePlugin('demo-plugin')).toThrow('invalid_transition');
    expect(getPlugin('demo-plugin')!.state).toBe('installed');

    // 重复 install：主键冲突抛错，原状态不受影响
    expect(() => installFromDirectory('demo-plugin')).toThrow();
    expect(getPlugin('demo-plugin')!.state).toBe('installed');
    expect(eventsFor('demo-plugin')).toHaveLength(4);

    // uninstalled 为终态
    getDb().prepare("UPDATE plugins SET state = 'uninstalled' WHERE id = 'demo-plugin'").run();
    expect(() => uninstallPlugin('demo-plugin')).toThrow('invalid_transition');
  });

  it('校验失败（缺 name / 非法 JSON）抛 manifest_invalid 且 plugins 表 0 行', () => {
    const withoutName = baseManifest('demo-plugin') as unknown as Record<string, unknown>;
    delete withoutName.name;
    writePlugin('demo-plugin', withoutName);
    expect(() => installFromDirectory('demo-plugin')).toThrow('manifest_invalid');
    expect(countRows('plugins')).toBe(0);

    writePlugin('bad-json-plugin', {}, '{ not json');
    expect(() => installFromDirectory('bad-json-plugin')).toThrow('manifest_invalid');
    expect(countRows('plugins')).toBe(0);
  });

  it('capabilities.register 抛错时 install 事务整体回滚（四表全 0 行）', () => {
    setCapabilities({
      register() {
        throw new Error('capability register failed');
      },
      unregister() {},
    });
    writePlugin('demo-plugin', baseManifest('demo-plugin'));

    expect(() => installFromDirectory('demo-plugin')).toThrow('capability register failed');
    expect(countRows('plugins')).toBe(0);
    expect(countRows('plugin_lifecycle_events')).toBe(0);
    expect(countRows('mcps')).toBe(0);
    expect(countRows('skills')).toBe(0);
  });

  it('verified 后 digest 持久化，等于 sha256(plugin.json 原文)', () => {
    const raw = writePlugin('demo-plugin', baseManifest('demo-plugin'));
    installFromDirectory('demo-plugin');

    const record = getPlugin('demo-plugin')!;
    expect(record.digest).toBeTruthy();
    expect(record.digest).toBe(createHash('sha256').update(raw).digest('hex'));
  });

  it('引擎检查：minVersion 高于宿主版本时抛中文错误', () => {
    writePlugin(
      'demo-plugin',
      baseManifest('demo-plugin', { engineCompatibility: { minVersion: '9.0.0' } }),
    );
    expect(() => installFromDirectory('demo-plugin')).toThrow('engine_incompatible');
    expect(() => installFromDirectory('demo-plugin')).toThrow(/宿主版本/);
    expect(countRows('plugins')).toBe(0);
  });

  it('provides 内部重复资源抛 namespace_conflict（message 含冲突资源名）', () => {
    writePlugin(
      'demo-plugin',
      baseManifest('demo-plugin', {
        provides: {
          mcpServers: [
            { id: 'dup-server', transport: 'stdio', command: 'a' },
            { id: 'dup-server', transport: 'stdio', command: 'b' },
          ],
        },
      }),
    );
    expect(() => installFromDirectory('demo-plugin')).toThrow('namespace_conflict');
    expect(() => installFromDirectory('demo-plugin')).toThrow('dup-server');
    expect(countRows('plugins')).toBe(0);
  });

  it('未配置 PLUGINS_DIR 或清单不存在时抛出对应错误', () => {
    delete process.env.PLUGINS_DIR;
    expect(() => installFromDirectory('demo-plugin')).toThrow('plugins_dir_not_configured');

    process.env.PLUGINS_DIR = pluginsDir;
    expect(() => installFromDirectory('ghost-plugin')).toThrow('manifest_not_found');
  });
});
