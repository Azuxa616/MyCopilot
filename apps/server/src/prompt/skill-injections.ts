import { getSkill, listSkills } from '../repo/skill.js';
import type { SkillInjection } from './assembler.js';

/**
 * 从 DB 构建注入对话 prompt 的 skills 列表。
 *
 * 修复 skills 注入死路径：skills 同步进 DB 后，生产路径（lifecycle 同步
 * SSE 流 / jobs worker 异步 agent-loop job）此前从未把 skills 传给
 * runAgentLoop，SkillInjection 注入链在 assembler 之前断裂。本函数补上
 * 缺失的解析环节，是两条生产入口共用的唯一 skills 来源。
 *
 * - 经 `listSkills({ enabled: true })` 取启用集合：目录同步（directory）、
 *   上传（upload）与未来的插件来源（plugin）走同一条 enabled 过滤路径，
 *   不按 source 区分。
 * - listSkills 只返回元数据（SkillMeta 无正文），正文需逐条 getSkill 取回
 *   （SkillDetail.content 即 body 列）。同步执行无并发窗口，开销为廉价的
 *   prepared-statement 主键查询。
 * - 顺序保持 listSkills 的 created_at DESC，满足 assembler
 *   "skills 由调用方按 createdAt 预排序" 的约定。
 */
export function buildSkillInjections(): SkillInjection[] {
  return listSkills({ enabled: true }).flatMap((meta) => {
    const detail = getSkill(meta.id);
    return detail
      ? [
          {
            name: detail.name,
            description: detail.description,
            triggers: detail.triggers,
            body: detail.content,
            always: detail.always,
          },
        ]
      : [];
  });
}
