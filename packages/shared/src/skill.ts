export interface SkillFrontmatter {
  name: string;
  description: string;
  triggers?: string[];
  version?: string;
}

/** Skill 来源：directory=目录同步、upload=用户上传、plugin=插件贡献（provides.skills 桥接写入）。 */
export type SkillSource = 'directory' | 'upload' | 'plugin';

/** skill 目录包的附属文件元数据（列表用，不含内容）。 */
export interface SkillFileMeta {
  /** 相对 skill 根目录的 posix 风格路径，如 'references/api.md'。 */
  path: string;
  size: number;
}

/** 创建/更新 skill 时传入的附属文件（含内容）。 */
export interface SkillFileInput {
  path: string;
  content: string;
}

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  source?: SkillSource;
  filePath?: string;
  /** frontmatter triggers（解析后持久化；缺省为空数组语义）。 */
  triggers?: string[];
  /** 附属文件数量（目录包模型；平铺/无附属为 0）。 */
  fileCount?: number;
}

export interface SkillDetail extends SkillMeta {
  content: string;
  /** 附属文件元数据列表（内容按需经 GET /api/skills/:id/files/:path 获取）。 */
  files?: SkillFileMeta[];
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
  raw: string;
}

export interface CreateSkillParams {
  name: string;
  description: string;
  body: string;
  source: SkillSource;
  filePath?: string;
  enabled?: boolean;
  triggers?: string[];
  files?: SkillFileInput[];
}

export interface UpdateSkillParams {
  name?: string;
  description?: string;
  body?: string;
  enabled?: boolean;
  triggers?: string[];
  /** 提供时全量替换该 skill 的附属文件。 */
  files?: SkillFileInput[];
}