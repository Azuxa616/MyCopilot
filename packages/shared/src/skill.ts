export interface SkillFrontmatter {
  name: string;
  description: string;
  triggers?: string[];
  version?: string;
}

export type SkillSource = 'directory' | 'upload';

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
