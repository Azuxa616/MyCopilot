import type { SkillMeta } from '@my-copilot/shared';
import { getSkill, listSkills } from '../repo/skill.js';
import type { SkillInjection } from './assembler.js';

/**
 * / 命令面板与 read_skill 共用的有效 skill 元数据集合。
 *
 * 有效集语义（diy-agent 白名单落地前的现状）：全局启用集合
 * `listSkills({ enabled: true })`。diy-agent 计划接入 agent_skills 白名单后，
 * 本函数是唯一需要升级为「绑定 ∩ 全局启用」的入口——命令面板 /
 * read_skill / buildSkillInjections 三方自动跟随，不另造集合。
 */
export function listEffectiveSkillMetas(): SkillMeta[] {
  return listSkills({ enabled: true });
}

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
 *
 * @param enforcedSkillIds / 命令携带的手动激活 skill 名（可选）。命中 name
 *   的条目按 always 语义全文注入（用户点名 = 确定性意图，绕过渐进披露）。
 *   仅在有效集内生效：未启用/不存在的名字静默忽略（enforced ∩ enabled，
 *   与 read_skill 可见集一致——不另造集合）。
 */
export function buildSkillInjections(enforcedSkillIds?: string[]): SkillInjection[] {
  const enforced = new Set(enforcedSkillIds ?? []);
  return listEffectiveSkillMetas().flatMap((meta) => {
    const detail = getSkill(meta.id);
    return detail
      ? [
          {
            name: detail.name,
            description: detail.description,
            triggers: detail.triggers,
            body: detail.content,
            always: detail.always || enforced.has(detail.name),
          },
        ]
      : [];
  });
}
