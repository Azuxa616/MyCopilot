/**
 * skillCapabilities 桥接集成测试（插件系统 T6）。
 *
 * 真实链路：mkdtemp 临时 PLUGINS_DIR + fixture plugin.json/skills md +
 * initDatabase 临时 SQLite 库，capabilities 经 setCapabilities 注入真实
 * skills 桥（afterEach 复位 noop 防泄漏），不 mock repo/parser。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginManifest } from '@my-copilot/shared';
import { initDatabase, getDb } from '../../db/index.js';
import {
  setCapabilities,
  installFromDirectory,
  enablePlugin,
  disablePlugin,
} from '../loader.js';
import { noopCapabilities } from '../capabilities.js';
import { skillCapabilities } from '../capabilities-skills.js';

interface SkillRow {
  id: string;
  name: string;
  description: string;
  body: string;
  source: string;
  file_path: string | null;
  source_plugin_id: string | null;
  enabled: number;
}

function pluginSkillRows(): SkillRow[] {
  return getDb()
    .prepare("SELECT * FROM skills WHERE source = 'plugin'")
    .all() as SkillRow[];
}

function countRows(table: string): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

const originalPluginsDir = process.env.PLUGINS_DIR;

describe('skillCapabilities（provides.skills → skills 表桥）', () => {
  let testDir: string;
  let pluginsDir: string;

  function baseManifest(
    name: string,
    skillPath: string,
    overrides: Partial<PluginManifest> = {},
  ): PluginManifest {
    return {
      version: '1.0.0',
      description: 'A test plugin',
      author: { name: 'Tester' },
      license: 'MIT',
      engineCompatibility: { minVersion: '0.1.0' },
      source: 'community',
      permissions: {},
      provides: { skills: [{ path: skillPath }] },
      ...overrides,
      name,
    };
  }

  /** 写插件目录：plugin.json + 可选的若干 skill md 文件（相对路径 → 内容）。 */
  function writePlugin(
    dirName: string,
    manifest: object,
    skillFiles: Record<string, string> = {},
  ): void {
    const pluginDir = join(pluginsDir, dirName);
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest));
    for (const [relPath, content] of Object.entries(skillFiles)) {
      const abs = join(pluginDir, relPath);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, content);
    }
  }

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-caps-skills-test-'));
    initDatabase(testDir);
    pluginsDir = join(testDir, 'plugins');
    process.env.PLUGINS_DIR = pluginsDir;
    setCapabilities(skillCapabilities);
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

  it('注册：install 后写入带命名空间前缀的行，字段取自 frontmatter', () => {
    writePlugin(
      'plugin-x',
      baseManifest('plugin-x', 'skills/code-review.md'),
      {
        'skills/code-review.md':
          '---\nname: code-review\ndescription: 审查代码变更并给出改进建议\n---\n\n# Code Review\n\n按清单逐项检查。\n',
      },
    );

    installFromDirectory('plugin-x');

    const rows = pluginSkillRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('plugin-x:code-review');
    expect(rows[0].description).toBe('审查代码变更并给出改进建议');
    expect(rows[0].body).toBe('\n# Code Review\n\n按清单逐项检查。\n');
    expect(rows[0].source).toBe('plugin');
    expect(rows[0].source_plugin_id).toBe('plugin-x');
    expect(rows[0].file_path).toBe('skills/code-review.md');
    expect(rows[0].enabled).toBe(1);
  });

  it('description 回退：frontmatter 无 description 时取正文首行并截断 50 字符', () => {
    const longFirstLine = '这'.repeat(80);
    writePlugin(
      'plugin-x',
      baseManifest('plugin-x', 'skills/desc-fallback.md'),
      {
        'skills/desc-fallback.md': `---\nname: desc-fallback\n---\n${longFirstLine}\n第二行\n`,
      },
    );

    installFromDirectory('plugin-x');

    const rows = pluginSkillRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('plugin-x:desc-fallback');
    expect(rows[0].description).toBe('这'.repeat(50));
  });

  it('name 回退：无 frontmatter 时用文件名去后缀，description 取正文首行', () => {
    writePlugin(
      'plugin-x',
      baseManifest('plugin-x', 'skills/notes.md'),
      { 'skills/notes.md': '# Just notes\n正文内容。\n' },
    );

    installFromDirectory('plugin-x');

    const rows = pluginSkillRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('plugin-x:notes');
    expect(rows[0].description).toBe('# Just notes');
  });

  it('失败：声明的 Skill 文件不存在 → install 抛中文错且事务整体回滚', () => {
    // 只写 plugin.json，不写 skills/missing.md
    writePlugin('plugin-x', baseManifest('plugin-x', 'skills/missing.md'));

    expect(() => installFromDirectory('plugin-x')).toThrow('skill_not_found');
    expect(() => installFromDirectory('plugin-x')).toThrow(/不存在或不可读/);

    expect(countRows('plugins')).toBe(0);
    expect(countRows('skills')).toBe(0);
    expect(countRows('plugin_lifecycle_events')).toBe(0);
    expect(countRows('mcps')).toBe(0);
  });

  it('unregister 清行；重复 register 幂等 upsert（更新而非重复插入）', () => {
    writePlugin(
      'plugin-x',
      baseManifest('plugin-x', 'skills/code-review.md', { source: 'official' }),
      {
        'skills/code-review.md':
          '---\nname: code-review\ndescription: 第一版描述\n---\n\n第一版正文。\n',
      },
    );

    installFromDirectory('plugin-x');
    expect(pluginSkillRows()).toHaveLength(1);
    expect(pluginSkillRows()[0].description).toBe('第一版描述');

    // 改写 md 内容后 enable 触发第二次 register：upsert 更新，不重复插行
    writeFileSync(
      join(pluginsDir, 'plugin-x', 'skills', 'code-review.md'),
      '---\nname: code-review\ndescription: 第二版描述\n---\n\n第二版正文。\n',
    );
    enablePlugin('plugin-x');

    const afterEnable = pluginSkillRows();
    expect(afterEnable).toHaveLength(1);
    expect(afterEnable[0].description).toBe('第二版描述');
    expect(afterEnable[0].body).toBe('\n第二版正文。\n');

    // disable → unregister → 行清空
    disablePlugin('plugin-x');
    expect(pluginSkillRows()).toHaveLength(0);

    // 再次 enable → 全新创建一行
    enablePlugin('plugin-x');
    expect(pluginSkillRows()).toHaveLength(1);
  });

  it('provides.skills 未声明时 register 为 no-op', () => {
    writePlugin(
      'plugin-x',
      baseManifest('plugin-x', 'skills/unused.md', {
        provides: { frontendEntry: { entry: 'frontend/index.html' } },
      }),
    );

    installFromDirectory('plugin-x');

    expect(pluginSkillRows()).toHaveLength(0);
    expect(getDb().prepare('SELECT id FROM plugins').all()).toHaveLength(1);
  });
});
