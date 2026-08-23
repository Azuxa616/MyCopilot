import type { ToolExecutor } from '../registry.js';
import {
  builtinTool,
  executeLocalTool,
  textResult,
  errorResult,
  requiredString,
  optionalString,
} from './helpers.js';
import { listEnabledSkills, getSkill, getSkillFile } from '../../repo/skill.js';
import { isSafeSkillFilePath } from '../../skills/limits.js';

/** 单次工具输出字符上限（安全阀；skill 正文按生态约定 <5k，references 可能更大）。 */
const READ_SKILL_MAX_CHARS = 64_000;

export const readSkillExecutor: ToolExecutor = {
  describe: () =>
    builtinTool({
      id: 'read-skill',
      name: 'read_skill',
      description:
        'Read the full instructions of an available skill, or one of its side files. ' +
        'Use after the skill manifest suggests a skill is relevant. ' +
        'Returns the skill name/description plus the requested content.',
      fields: [
        { name: 'name', type: 'string', description: 'Exact skill name from the manifest', required: true },
        { name: 'path', type: 'string', description: "Optional side-file path (e.g. 'references/api.md'); omit for the SKILL.md body", required: false },
      ],
    }),
  async execute(args, context) {
    return executeLocalTool(context, () => {
      const name = requiredString(args, 'name', 500);
      const path = optionalString(args, 'path', 1000);

      // 可见集 = 全局 enabled（agent_skills 白名单过滤由 diy-agent 计划接入）
      const match = listEnabledSkills().find((s) => s.name === name);
      if (!match) {
        return errorResult(`Skill "${name}" 不在当前可用技能集内（未启用或不存在）。`);
      }
      const detail = getSkill(match.id);
      if (!detail) return errorResult(`Skill "${name}" 读取失败。`);

      let text: string;
      if (path === undefined) {
        text = `# ${detail.name}\n\n${detail.description}\n\n---\n\n${detail.content}`;
      } else {
        if (!isSafeSkillFilePath(path)) {
          return errorResult('Invalid path：不允许 ..、绝对路径或反斜杠。');
        }
        const file = getSkillFile(match.id, path);
        if (!file) return errorResult(`Skill "${name}" 没有附属文件 ${path}。`);
        text = file.content;
      }

      if (text.length > READ_SKILL_MAX_CHARS) {
        text = text.slice(0, READ_SKILL_MAX_CHARS) + '\n…[truncated]';
      }
      return textResult(text);
    });
  },
};
