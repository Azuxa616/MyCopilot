-- Phase 2: Rebuild messages table to add 'tool' role and new columns.
-- SQLite cannot modify CHECK constraints via ALTER TABLE, so we rebuild.
CREATE TABLE messages_new (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  tool_calls TEXT DEFAULT NULL,
  tool_call_id TEXT DEFAULT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'aborted')),
  error TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

INSERT INTO messages_new (id, session_id, role, content, attachments, status, error, created_at)
SELECT id, session_id, role, content, attachments, status, error, created_at FROM messages;

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;
CREATE INDEX idx_messages_session_id ON messages(session_id);

-- tools table
CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  input_schema TEXT NOT NULL DEFAULT '{}',
  type TEXT NOT NULL CHECK (type IN ('built-in', 'mcp-provided')),
  danger_level TEXT NOT NULL CHECK (danger_level IN ('low', 'medium', 'high')),
  source_mcp_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- skills table
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('directory', 'upload')),
  file_path TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skills_source ON skills(source);

-- mcps table
CREATE TABLE IF NOT EXISTS mcps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('stdio', 'sse', 'http')),
  command TEXT,
  args TEXT NOT NULL DEFAULT '[]',
  env TEXT NOT NULL DEFAULT '{}',
  url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_connected_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- agent junction tables (Phase 3 prep)
CREATE TABLE IF NOT EXISTS agent_tools (
  agent_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  PRIMARY KEY (agent_id, tool_id)
);

CREATE TABLE IF NOT EXISTS agent_skills (
  agent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  PRIMARY KEY (agent_id, skill_id)
);

CREATE TABLE IF NOT EXISTS agent_mcps (
  agent_id TEXT NOT NULL,
  mcp_id TEXT NOT NULL,
  PRIMARY KEY (agent_id, mcp_id)
);
