-- Context v2: cross-session memory persistence (RFC: docs/rfc/context-management-v2.md §4).
-- Keyword LIKE retrieval only — Vector DB / embeddings are an explicit Non-Goal.
-- Upsert-on-(session_id, key) semantics live in repo/memory.ts.
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id, key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_session_key ON memories(session_id, key);
