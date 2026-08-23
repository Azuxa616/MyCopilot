-- Skill 目录包模型（设计 docs/2026-08-22-skill-system-upgrade-design.md）
-- 附属文件表：SKILL.md 正文仍在 skills.body，附属文件（references/assets）入本表。
CREATE TABLE skill_files (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  UNIQUE (skill_id, path)
);
CREATE INDEX IF NOT EXISTS idx_skill_files_skill_id ON skill_files(skill_id);

-- frontmatter triggers 持久化（JSON string[]，缺省 '[]'）。
ALTER TABLE skills ADD COLUMN triggers TEXT NOT NULL DEFAULT '[]';