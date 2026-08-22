/**
 * Skill 目录包附属文件的统一限额与白名单（设计文档决策记录）。
 * scanner（目录同步，超限跳过）与 zip-import（导入，超限报错）共用。
 */

/** 单个附属文件大小上限（字节）。 */
export const SKILL_FILE_MAX_BYTES = 256 * 1024;

/** 每个 skill 的附属文件数量上限。 */
export const SKILL_MAX_FILES = 20;

/** 每个 skill 的附属文件总大小上限（字节）。 */
export const SKILL_FILES_TOTAL_MAX_BYTES = 1024 * 1024;

/** 允许收录的文本文件扩展名（skill 脚本/二进制一律排除）。 */
const TEXT_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.json',
  '.csv',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
]);

/** 判断文件名是否属于允许收录的文本类型（按扩展名，大小写不敏感）。 */
export function isSkillTextFile(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXT_EXTENSIONS.has(fileName.slice(dot).toLowerCase());
}