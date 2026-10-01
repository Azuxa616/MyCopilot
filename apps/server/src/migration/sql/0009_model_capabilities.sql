-- 模型能力探测（设计 docs/2026-09-30-model-capability-design.md）
-- 三态能力标记 + 来源标注，JSON 存储；存量 '{}' = 全 unknown，零数据迁移。
ALTER TABLE models ADD COLUMN capabilities TEXT NOT NULL DEFAULT '{}';
