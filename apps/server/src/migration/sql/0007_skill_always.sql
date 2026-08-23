-- Skill 渐进披露（设计 docs/2026-08-22-skill-system-upgrade-design.md 支柱三）：
-- always=1 的 skill 绕过清单、全文常驻注入。
ALTER TABLE skills ADD COLUMN always INTEGER NOT NULL DEFAULT 0;