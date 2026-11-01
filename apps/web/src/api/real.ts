/**
 * Real API implementation barrel
 *
 * 实现按域拆分至 ./real/ 目录（sessions、assets、auth、providers、tools、settings、skills、mcps、jobs、plugins），
 * 本文件仅做统一再导出，供 api/index.ts 以 `import * as real from './real'` 消费。
 */

export * from './real/sessions';
export * from './real/assets';
export * from './real/auth';
export * from './real/providers';
export * from './real/tools';
export * from './real/settings';
export * from './real/skills';
export * from './real/mcps';
export * from './real/jobs';
export * from './real/plugins';
