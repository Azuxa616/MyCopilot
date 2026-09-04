import type { ToolExecutor } from '../registry.js';
import { builtinTool, requiredString, textResult, errorResult } from './helpers.js';
import { listRepoSkills } from '../../skills/github.js';

export const listGithubSkillsExecutor: ToolExecutor = {
  describe: () =>
    builtinTool({
      id: 'list-github-skills',
      name: 'list_github_skills',
      description:
        'List the skills available in a GitHub repository (read-only). ' +
        "Returns each skill's name, description, path and side-file count. " +
        'Use this to find a skill matching the user\'s need, then install it with install_skill.',
      fields: [
        {
          name: 'repoUrl',
          type: 'string',
          description: 'Repository URL, e.g. https://github.com/anthropics/skills',
          required: true,
        },
      ],
    }),
  async execute(args, context) {
    if (context.signal?.aborted) return errorResult('Tool execution was cancelled');
    try {
      const repoUrl = requiredString(args, 'repoUrl', 1000);
      const m = await listRepoSkills(repoUrl);
      const lines = m.entries
        .map(
          (e) => `- path: ${e.path || '(root)'} | name: ${e.name} | ${e.description} | ${e.fileCount} 个附属文件`,
        )
        .join('\n');
      const text =
        `仓库 ${m.repo} 共 ${m.entries.length} 个 skill：\n${lines}\n` +
        (m.entries.length > 0 ? '用 install_skill(repoUrl, path) 安装其中之一。' : '');
      return textResult(text);
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  },
};