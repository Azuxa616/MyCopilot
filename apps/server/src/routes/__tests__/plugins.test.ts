/**
 * /api/plugins 路由集成测试（插件系统 T9）。
 *
 * 真实链路：mkdtemp 临时 PLUGINS_DIR + fixture plugin.json/skills 文件 +
 * initDatabase 临时 SQLite 库，不 mock loader/repo/能力桥——import
 * ../plugins.js 即触发模块顶部的 setCapabilities(combinedCapabilities)
 * 装配（capabilities-combined.ts 的装配契约），install/enable 断言
 * mcps/skills 命名空间行即是对装配生效的直接验证（noop 默认下不会有行）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { PluginManifest } from '@my-copilot/shared';
import { initDatabase, getDb } from '../../db/index.js';
import { errorMiddleware } from '../../middleware/error.js';
import { setCapabilities } from '../../plugin/loader.js';
import { noopCapabilities } from '../../plugin/capabilities.js';
import { combinedCapabilities } from '../../plugin/capabilities-combined.js';
import { pluginsApp } from '../plugins.js';

type ApiResponse = {
  code: number;
  msg: string;
  data: unknown;
};

interface McpRow {
  id: string;
  name: string;
  enabled: number;
  source_plugin_id: string | null;
}

function createTestApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/', pluginsApp);
  return app;
}

async function request(
  app: ReturnType<typeof createTestApp>,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: ApiResponse }> {
  const res = await app.request(path, init);
  return { status: res.status, body: (await res.json()) as ApiResponse };
}

function postJson(app: ReturnType<typeof createTestApp>, path: string, payload: unknown) {
  return request(app, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function patch(app: ReturnType<typeof createTestApp>, path: string) {
  return request(app, path, { method: 'PATCH' });
}

function countRows(table: string, where = ''): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`)
    .get() as { n: number };
  return row.n;
}

function mcpRowsByPlugin(pluginId: string): McpRow[] {
  return getDb()
    .prepare('SELECT * FROM mcps WHERE source_plugin_id = ? ORDER BY rowid')
    .all(pluginId) as McpRow[];
}

const originalPluginsDir = process.env.PLUGINS_DIR;

describe('plugins route', () => {
  let testDir: string;
  let pluginsDir: string;
  let app: ReturnType<typeof createTestApp>;

  /**
   * official 插件清单：mcpServer + skill 双能力。
   * 社区/坏清单等变体经 overrides 派生。
   */
  function baseManifest(name: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
      version: '1.0.0',
      description: 'A test plugin',
      author: { name: 'Tester' },
      license: 'MIT',
      engineCompatibility: { minVersion: '0.1.0' },
      source: 'official',
      permissions: {},
      provides: {
        mcpServers: [{ id: 'fs-tools', transport: 'stdio' as const, command: 'node' }],
        skills: [{ path: 'skills/code-review.md' }],
      },
      ...overrides,
      name,
    };
  }

  /** 在 PLUGINS_DIR 下写一个插件目录（plugin.json + 声明的 skill 文件）。 */
  function writePlugin(dirName: string, manifest: object, raw?: string): void {
    const pluginDir = join(pluginsDir, dirName);
    mkdirSync(join(pluginDir, 'skills'), { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), raw ?? JSON.stringify(manifest));
    writeFileSync(join(pluginDir, 'skills', 'code-review.md'), '---\nname: code-review\n---\n# code review\n');
  }

  /** 便捷：写好 official-toolkit（双能力）并安装。 */
  async function installOfficialToolkit() {
    writePlugin('official-toolkit', baseManifest('official-toolkit'));
    return postJson(app, '/install', { directory: 'official-toolkit' });
  }

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-plugins-route-test-'));
    initDatabase(testDir);
    pluginsDir = join(testDir, 'plugins');
    process.env.PLUGINS_DIR = pluginsDir;
    // 重新显式装配（防其他测试文件的 noop 复位在共享模块态下泄漏）
    setCapabilities(combinedCapabilities);
    app = createTestApp();
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

  describe('POST /install', () => {
    it('安装 official 插件 → 200 state=installed，且 mcps/skills 命名空间行已写（装配验证）', async () => {
      const { status, body } = await installOfficialToolkit();

      expect(status).toBe(200);
      const record = body.data as Record<string, unknown>;
      expect(record.id).toBe('official-toolkit');
      expect(record.state).toBe('installed');
      expect(record.source).toBe('official');
      expect((record.manifest as PluginManifest).name).toBe('official-toolkit');

      // install 链 register 写 enabled=false 的 mcp 行（插件尚未启用）
      const mcps = mcpRowsByPlugin('official-toolkit');
      expect(mcps).toHaveLength(1);
      expect(mcps[0].id).toBe('official-toolkit:fs-tools');
      expect(mcps[0].name).toBe('official-toolkit:fs-tools');
      expect(mcps[0].enabled).toBe(0);

      // skills 桥写入带 pluginId: 前缀的命名空间行
      const skills = getDb()
        .prepare('SELECT name FROM skills WHERE source_plugin_id = ?')
        .all('official-toolkit') as { name: string }[];
      expect(skills.map((s) => s.name)).toEqual(['official-toolkit:code-review']);
    });

    it('directory 未传或非字符串 → 400', async () => {
      const missing = await postJson(app, '/install', {});
      expect(missing.status).toBe(400);
      expect(missing.body.msg).toContain('directory');

      const notString = await postJson(app, '/install', { directory: 42 });
      expect(notString.status).toBe(400);
    });

    it('目录不存在 → 404（manifest_not_found）', async () => {
      const { status, body } = await postJson(app, '/install', { directory: 'ghost-plugin' });
      expect(status).toBe(404);
      expect(body.msg).toContain('manifest_not_found');
    });

    it('坏清单 → 400 + errors 数组，且 plugins 表无行', async () => {
      const bad = baseManifest('bad-plugin');
      delete (bad as Partial<PluginManifest>).version;
      writePlugin('bad-plugin', bad);

      const { status, body } = await postJson(app, '/install', { directory: 'bad-plugin' });
      expect(status).toBe(400);
      expect(body.msg).toContain('manifest_invalid');
      const errors = (body.data as { errors: string[] }).errors;
      expect(Array.isArray(errors)).toBe(true);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('version');
      expect(countRows('plugins')).toBe(0);
    });

    it('非法 JSON 清单 → 400 + 单元素 errors 数组', async () => {
      writePlugin('bad-json-plugin', baseManifest('bad-json-plugin'), '{ not json');
      const { status, body } = await postJson(app, '/install', { directory: 'bad-json-plugin' });
      expect(status).toBe(400);
      const errors = (body.data as { errors: string[] }).errors;
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('合法 JSON');
    });

    it('引擎不兼容 → 400（engine_incompatible）', async () => {
      writePlugin(
        'future-plugin',
        baseManifest('future-plugin', { engineCompatibility: { minVersion: '9.0.0' } }),
      );
      const { status, body } = await postJson(app, '/install', { directory: 'future-plugin' });
      expect(status).toBe(400);
      expect(body.msg).toContain('engine_incompatible');
      expect(countRows('plugins')).toBe(0);
    });
  });

  describe('PATCH /:id/enable', () => {
    it('official 插件 → 200 state=enabled，mcp 行 enabled=1（经装配的 mcp 桥）', async () => {
      await installOfficialToolkit();

      const { status, body } = await patch(app, '/official-toolkit/enable');
      expect(status).toBe(200);
      expect((body.data as Record<string, unknown>).state).toBe('enabled');

      const mcps = mcpRowsByPlugin('official-toolkit');
      expect(mcps).toHaveLength(1);
      expect(mcps[0].enabled).toBe(1);
      // skills 行保持
      expect(countRows('skills', "WHERE source_plugin_id = 'official-toolkit'")).toBe(1);
    });

    it('community 插件 → 403（community_enable_forbidden）', async () => {
      writePlugin('community-greeter', baseManifest('community-greeter', { source: 'community' }));
      await postJson(app, '/install', { directory: 'community-greeter' });

      const { status, body } = await patch(app, '/community-greeter/enable');
      expect(status).toBe(403);
      expect(body.msg).toContain('community_enable_forbidden');
      expect((await request(app, '/community-greeter')).status).toBe(200);
    });

    it('不存在的插件 → 404', async () => {
      const { status } = await patch(app, '/nope/enable');
      expect(status).toBe(404);
    });

    it('与其他已启用插件命名空间冲突 → 409（namespace_conflict）', async () => {
      await installOfficialToolkit();
      await patch(app, '/official-toolkit/enable');

      writePlugin('official-clone', baseManifest('official-clone'));
      await postJson(app, '/install', { directory: 'official-clone' });
      // 防御性兜底场景：手工造一行 official-clone 名下与其他 enabled 插件同名的 mcp
      getDb()
        .prepare(
          `INSERT INTO mcps (id, name, description, transport, args, env, enabled, created_at, updated_at, source_plugin_id)
           VALUES ('clone-collide', 'official-toolkit:fs-tools', 'collide', 'stdio', '[]', '{}', 1, 0, 0, 'official-clone')`,
        )
        .run();

      const { status, body } = await patch(app, '/official-clone/enable');
      expect(status).toBe(409);
      expect(body.msg).toContain('namespace_conflict');
      // 状态未被改动
      const clone = (await request(app, '/official-clone')).body.data as Record<string, unknown>;
      expect(clone.state).toBe('installed');
    });

    it('已 enabled 的插件再 enable → 409（invalid_transition）', async () => {
      await installOfficialToolkit();
      await patch(app, '/official-toolkit/enable');

      const { status, body } = await patch(app, '/official-toolkit/enable');
      expect(status).toBe(409);
      expect(body.msg).toContain('invalid_transition');
    });
  });

  describe('PATCH /:id/disable', () => {
    it('enabled 插件 → 200 state=disabled，mcp 行按 unregister 删行语义清除', async () => {
      await installOfficialToolkit();
      await patch(app, '/official-toolkit/enable');

      const { status, body } = await patch(app, '/official-toolkit/disable');
      expect(status).toBe(200);
      expect((body.data as Record<string, unknown>).state).toBe('disabled');

      expect(mcpRowsByPlugin('official-toolkit')).toHaveLength(0);
      expect(countRows('skills', "WHERE source_plugin_id = 'official-toolkit'")).toBe(0);
    });

    it('非 enabled 态 → 409（invalid_transition）', async () => {
      await installOfficialToolkit();
      const { status, body } = await patch(app, '/official-toolkit/disable');
      expect(status).toBe(409);
      expect(body.msg).toContain('invalid_transition');
    });

    it('不存在的插件 → 404', async () => {
      const { status } = await patch(app, '/nope/disable');
      expect(status).toBe(404);
    });
  });

  describe('DELETE /:id', () => {
    it('official 插件 → 403（official_uninstall_forbidden）', async () => {
      await installOfficialToolkit();

      const { status, body } = await request(app, '/official-toolkit', { method: 'DELETE' });
      expect(status).toBe(403);
      expect(body.msg).toContain('official_uninstall_forbidden');
      expect((await request(app, '/official-toolkit')).status).toBe(200);
    });

    it('community 插件 → 200，关联行全清且终态 uninstalled', async () => {
      writePlugin('community-greeter', baseManifest('community-greeter', { source: 'community' }));
      await postJson(app, '/install', { directory: 'community-greeter' });
      expect(countRows('skills', "WHERE source_plugin_id = 'community-greeter'")).toBe(1);
      // 造一行 plugin_data 验证卸载时一并清除
      getDb()
        .prepare(
          `INSERT INTO plugin_data (plugin_id, key, value, created_at, updated_at)
           VALUES ('community-greeter', 'k', '"v"', 0, 0)`,
        )
        .run();

      const { status, body } = await request(app, '/community-greeter', { method: 'DELETE' });
      expect(status).toBe(200);
      expect(body.data).toEqual({ deleted: true });

      expect(countRows('mcps', "WHERE source_plugin_id = 'community-greeter'")).toBe(0);
      expect(countRows('skills', "WHERE source_plugin_id = 'community-greeter'")).toBe(0);
      expect(countRows('plugin_data', "WHERE plugin_id = 'community-greeter'")).toBe(0);

      const record = (await request(app, '/community-greeter')).body.data as Record<string, unknown>;
      expect(record.state).toBe('uninstalled');
    });

    it('不存在的插件 → 404', async () => {
      const { status } = await request(app, '/nope', { method: 'DELETE' });
      expect(status).toBe(404);
    });
  });

  describe('GET / 与 GET /:id 与 GET /:id/events', () => {
    it('GET / 返回全部插件（含 state 与 manifest）', async () => {
      await installOfficialToolkit();
      writePlugin('community-greeter', baseManifest('community-greeter', { source: 'community' }));
      await postJson(app, '/install', { directory: 'community-greeter' });

      const { status, body } = await request(app, '/');
      expect(status).toBe(200);
      const list = body.data as Record<string, unknown>[];
      expect(list).toHaveLength(2);
      const ids = list.map((p) => p.id).sort();
      expect(ids).toEqual(['community-greeter', 'official-toolkit']);
      expect(list.every((p) => typeof p.state === 'string' && p.manifest)).toBe(true);
    });

    it('GET /:id 返回含 manifest 快照；不存在 → 404', async () => {
      await installOfficialToolkit();

      const found = await request(app, '/official-toolkit');
      expect(found.status).toBe(200);
      const record = found.body.data as Record<string, unknown>;
      expect((record.manifest as PluginManifest).provides.mcpServers?.[0].id).toBe('fs-tools');

      const missing = await request(app, '/nope');
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe(404);
    });

    it('GET /:id/events 返回事件列表（字段齐全）；不存在 → 404', async () => {
      await installOfficialToolkit();
      await patch(app, '/official-toolkit/enable');

      const { status, body } = await request(app, '/official-toolkit/events');
      expect(status).toBe(200);
      const events = body.data as Record<string, unknown>[];
      expect(events).toHaveLength(5);
      // 同毫秒时间戳下 created_at DESC 次序不稳定，按集合断言状态覆盖
      expect(new Set(events.map((e) => e.toState))).toEqual(
        new Set(['discovered', 'downloaded', 'verified', 'installed', 'enabled']),
      );
      for (const e of events) {
        expect(e.eventId).toBeTruthy();
        expect(e.pluginId).toBe('official-toolkit');
        expect(e.version).toBe('1.0.0');
        expect(e.trigger).toBeTruthy();
        expect(e.result).toEqual({ status: 'success' });
        expect(typeof e.timestamp).toBe('number');
      }
      // enable 事件 trigger 为 user
      const enabledEvent = events.find((e) => e.toState === 'enabled');
      expect(enabledEvent?.trigger).toBe('user');

      const missing = await request(app, '/nope/events');
      expect(missing.status).toBe(404);
    });
  });
});
