-- 0010: messages.reasoning —— Extended Thinking 推理文本随消息持久化。
-- 纯文本直存（非 JSON）；仅供前端历史渲染，assembleMessagesV2 装配
-- LLM 输入时显式忽略该列（防历史 reasoning 吃六桶预算）。
-- SQLite ADD COLUMN 无默认：迁移前的旧数据保持 NULL。
ALTER TABLE messages ADD COLUMN reasoning TEXT;
