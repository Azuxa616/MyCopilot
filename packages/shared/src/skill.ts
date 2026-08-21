export interface SkillFrontmatter {
  name: string;
  description: string;
  triggers?: string[];
  version?: string;
}

/** Skill 来源：directory=目录同步、upload=用户上传、plugin=插件贡献（provides.skills 桥接写入）。 */
export type SkillSource = 'directory' | 'upload' | 'plugin';

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  source?: SkillSource;
  filePath?: string;
}

export interface SkillDetail extends SkillMeta {
  content: string;
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
}

export interface UpdateSkillParams {
  name?: string;
  description?: string;
  body?: string;
  enabled?: boolean;
}
