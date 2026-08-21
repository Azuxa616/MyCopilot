/**
 * MCP 能力桥集成测试（插件系统 T5）。
 *
 * 真实链路：mkdtemp 临时 PLUGINS_DIR + fixture plugin.json + initDatabase
 * 临时 SQLite 库。capabilities 经 setCapabilities(combinedCapabilities)
 * 装配（同时覆盖 combined 聚合的接线；mcpServers-only 清单下 skills 桥
 * no-op），afterEach 复位 noop 防泄漏（照 loader.test.ts 模式）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginManifest } from '@my-copilot/shared';
import { initDatabase, getDb } from '../../db/index.js';
import { getPlugin } from '../../repo/plugin.js';
import { setCapabilities, installFromDirectory, enablePlugin, disablePlugin } from '../loader.js';
import { noopCapabilities } from '../capabilities.js';
import { combinedCapabilities } from '../capabilities-combined.js';
import { mcpCapabilities } from '../capabilities-mcp.js';

interface McpRow {
  id: string;
  name: string;
  description: string;
  transport: string;
  command: string | null;
  args: string;
  env: string;
  url: string | null;
  enabled: number;
  source_plugin_id: string | null;
}

/** 按 rowid（插入顺序）取 mcps 行，避免同毫秒时间戳下排序不稳定。 */
function mcpRows(): McpRow[] {
  return getDb()
    .prepare('SELECT * FROM mcps ORDER BY rowid')
    .all() as McpRow[];
}

function countRows(table: string): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

const originalPluginsDir = process.env.PLUGINS_DIR;

describe('mcpCapabilities（MCP 能力桥）', () => {
  let testDir: string;
  let pluginsDir: string;

  function baseManifest(name: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
      version: '1.0.0',
      description: 'A test plugin',
      author: { name: 'Tester' },
      license: 'MIT',
      engineCompatibility: { minVersion: '0.1.0' },
      source: 'community',
      permissions: {},
      provides: {
        mcpServers: [{ id: 'acme-mcp', transport: 'stdio' as const, command: 'acme-server', args: ['--stdio'] }],
      },
      ...overrides,
      name,
    };
  }

  /** 在 PLUGINS_DIR 下写一个插件目录（仅 plugin.json，mcpServers 不需要文件）。 */
  function writePlugin(dirName: string, manifest: object): void {
    const pluginDir = join(pluginsDir, dirName);
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest));
  }

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-cap-mcp-test-'));
    initDatabase(testDir);
    pluginsDir = join(testDir, 'plugins');
    process.env.PLUGINS_DIR = pluginsDir;
    setCapabilities(combinedCapabilities);
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

  it('install 注册：mcps 表出现 plugin-x:acme-mcp 行，source_plugin_id/description/命令齐全', () => {
    writePlugin('plugin-x', baseManifest('plugin-x'));

    installFromDirectory('plugin-x');

    const rows = mcpRows();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe('plugin-x:acme-mcp');
    expect(row.name).toBe('plugin-x:acme-mcp');
    expect(row.description).toBe('plugin-x acme-mcp MCP 服务（由插件提供）');
    expect(row.description.length).toBeGreaterThan(0);
    expect(row.transport).toBe('stdio');
    expect(row.command).toBe('acme-server');
    expect(JSON.parse(row.args)).toEqual(['--stdio']);
    expect(row.source_plugin_id).toBe('plugin-x');
    // install 链上插件尚未 enable → MCP 行 enabled=0
    expect(row.enabled).toBe(0);
  });

  it('official enable 链：已有行更新为 enabled=1；disable 后 unregister 清行', () => {
    writePlugin('official-plugin', baseManifest('official-plugin', { source: 'official' }));
    installFromDirectory('official-plugin');
    expect(mcpRows()[0].enabled).toBe(0);

    // enablePlugin 再次走 register：行已存在 → 更新为启用，不产生第二行
    enablePlugin('official-plugin');
    const enabledRows = mcpRows();
    expect(enabledRows).toHaveLength(1);
    expect(enabledRows[0].id).toBe('official-plugin:acme-mcp');
    expect(enabledRows[0].enabled).toBe(1);

    // disable → unregister → deleteMcpsByPlugin 清行（断连对不存在的连接是 no-op）
    disablePlugin('official-plugin');
    expect(mcpRows()).toHaveLength(0);
  });

  it('非 stdio transport → 抛中文错且 install 事务回滚（mcps/plugins 全 0 行）', () => {
    writePlugin(
      'plugin-x',
      baseManifest('plugin-x', {
        provides: {
          mcpServers: [{ id: 'remote-mcp', transport: 'http' as const, url: 'https://example.com/mcp' }],
        },
      }),
    );

    expect(() => installFromDirectory('plugin-x')).toThrow('mcp_transport_unsupported');
    expect(() => installFromDirectory('plugin-x')).toThrow(/remote-mcp/);
    expect(() => installFromDirectory('plugin-x')).toThrow(/stdio/);
    expect(countRows('mcps')).toBe(0);
    expect(countRows('plugins')).toBe(0);
  });

  it('register 幂等：行已存在时 enable 链刷新 enabled，install 链跳过', () => {
    writePlugin('plugin-x', baseManifest('plugin-x'));
    installFromDirectory('plugin-x');

    const record = getPlugin('plugin-x')!;
    expect(record.state).toBe('installed');

    // enable 链（state='installed'）：已存在的行 → 更新为启用
    mcpCapabilities.register(record, pluginsDir);
    expect(mcpRows()).toHaveLength(1);
    expect(mcpRows()[0].enabled).toBe(1);

    // install 链（state='verified'）：已存在的行 → 跳过（不回退 enabled、不报错）
    mcpCapabilities.register({ ...record, state: 'verified' }, pluginsDir);
    expect(mcpRows()).toHaveLength(1);
    expect(mcpRows()[0].enabled).toBe(1);
  });

  it('unregister：deleteMcpsByPlugin 只清本插件行，另一插件行不受影响', () => {
    writePlugin('plugin-x', baseManifest('plugin-x'));
    writePlugin('plugin-y', baseManifest('plugin-y'));
    installFromDirectory('plugin-x');
    installFromDirectory('plugin-y');
    expect(mcpRows()).toHaveLength(2);

    mcpCapabilities.unregister('plugin-x');

    const rows = mcpRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('plugin-y:acme-mcp');
    expect(rows[0].source_plugin_id).toBe('plugin-y');
  });
});
