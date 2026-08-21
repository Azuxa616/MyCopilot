/**
 * 插件 provides.skills → skills 表桥接（插件系统 T6）。
 *
 * register：遍历 manifest.provides.skills，逐个读取插件目录内的 markdown，
 * 经 skills/parser.ts（gray-matter，与 skills/sync.ts 同一解析惯例）取
 * frontmatter 与正文后 upsert 进 skills 表：source='plugin'、name 加
 * `${pluginId}:` 命名空间前缀。声明的文件不存在即抛中文错，触发
 * installFromDirectory 的事务整体回滚（C5 语义）。
 * unregister：删除该插件贡献的全部行（deleteSkillsByPlugin）。
 */
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { PluginRecord } from '../repo/plugin.js';
import { parseSkillMarkdown } from '../skills/parser.js';
import {
  createSkill,
  updateSkill,
  findSkillByPluginAndName,
  deleteSkillsByPlugin,
} from '../repo/skill.js';
import { PluginLifecycleError } from './loader.js';
import type { PluginCapabilities } from './capabilities.js';

/** description 合成回退（正文首行）时的截断长度。 */
const DESCRIPTION_FALLBACK_LIMIT = 50;

/** frontmatter.name 缺失时以文件名去后缀作为短名。 */
function baseSkillName(path: string, frontmatterName: string): string {
  return frontmatterName || basename(path).replace(/\.md$/i, '');
}

/** description NOT NULL 的合成回退：正文首个非空行，截断 50 字符。 */
function synthesizeDescription(body: string): string {
  const firstLine =
    body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';
  return firstLine.slice(0, DESCRIPTION_FALLBACK_LIMIT);
}

export const skillCapabilities: PluginCapabilities = {
  register(plugin: PluginRecord, pluginDir: string): void {
    const skillRefs = plugin.manifest.provides.skills;
    if (!skillRefs) return;

    for (const skillRef of skillRefs) {
      const absolutePath = join(pluginDir, skillRef.path);

      let raw: string;
      try {
        raw = readFileSync(absolutePath, 'utf-8');
      } catch {
        throw new PluginLifecycleError(
          'skill_not_found',
          `插件 ${plugin.id} 声明的 Skill 文件不存在或不可读：${skillRef.path}`,
        );
      }

      const parsed = parseSkillMarkdown(raw);
      const name = `${plugin.id}:${baseSkillName(skillRef.path, parsed.frontmatter.name)}`;
      const description =
        parsed.frontmatter.description || synthesizeDescription(parsed.body);

      // 幂等 upsert（语义同 skills/sync.ts）：同插件同名 → 更新，否则新建。
      const existing = findSkillByPluginAndName(plugin.id, name);
      if (existing) {
        updateSkill(existing.id, { name, description, body: parsed.body });
      } else {
        createSkill({
          name,
          description,
          body: parsed.body,
          source: 'plugin',
          filePath: skillRef.path,
          sourcePluginId: plugin.id,
        });
      }
    }
  },

  unregister(pluginId: string): void {
    deleteSkillsByPlugin(pluginId);
  },
};
