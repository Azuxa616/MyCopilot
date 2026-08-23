import type { Tool } from '@my-copilot/shared';
import type { ToolExecutor } from '../registry.js';
import { builtinTool, optionalString, textResult, errorResult } from './helpers.js';
import { parseSkillMarkdown } from '../../skills/parser.js';
import { createSkill } from '../../repo/skill.js';
import { importRepoSkill } from '../../skills/github.js';

function describeInstallSkill(): Tool {
  const base = builtinTool({
    id: 'install-skill',
    name: 'install_skill',
    description:
      'Install a skill so it is available in future conversations. ' +
      "EITHER pass content (a complete SKILL.md with YAML frontmatter name/description) to save a drafted skill, " +
      "OR pass repoUrl (+ optional path from list_github_skills) to install from a GitHub repository. " +
      'When multiple repo skills match the user\'s request: present up to 3 candidates and ask; ' +
      'if more than 3, pick the best and explain why. Always show the user what will be installed.',
    fields: [
      { name: 'repoUrl', type: 'string', description: 'GitHub repository URL', required: false },
      {
        name: 'path',
        type: 'string',
        description: 'Skill path inside the repo (from list_github_skills)',
        required: false,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Complete SKILL.md content (frontmatter + body)',
        required: false,
      },
    ],
  });
  return { ...base, safetyLevel: 'restricted' as const };
}

export const installSkillExecutor: ToolExecutor = {
  describe: describeInstallSkill,
  async execute(args, context) {
    if (context.signal?.aborted) return errorResult('Tool execution was cancelled');
    try {
      const repoUrl = optionalString(args, 'repoUrl', 1000);
      const path = optionalString(args, 'path', 1000);
      const content = optionalString(args, 'content', 512 * 1024);

      if (repoUrl) {
        const detail = await importRepoSkill(repoUrl, path);
        return textResult(`已安装 skill「${detail.name}」：${detail.description}（下个会话起生效）`);
      }

      if (content !== undefined) {
        const parsed = parseSkillMarkdown(content);
        if (!parsed.frontmatter.name) {
          return errorResult(
            'SKILL.md 的 frontmatter 缺少 name 字段（需要 YAML 头：name/description）。',
          );
        }
        const detail = createSkill({
          name: parsed.frontmatter.name,
          description: parsed.frontmatter.description,
          body: parsed.body,
          triggers: parsed.frontmatter.triggers,
          always: parsed.frontmatter.always,
          source: 'upload',
        });
        return textResult(`已安装 skill「${detail.name}」：${detail.description}（下个会话起生效）`);
      }

      return errorResult('必须提供 repoUrl 或 content 参数之一。');
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  },
};