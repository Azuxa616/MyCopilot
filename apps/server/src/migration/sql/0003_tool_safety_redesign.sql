CREATE TABLE tools_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  input_schema TEXT NOT NULL DEFAULT '{}',
  type TEXT NOT NULL CHECK (type IN ('built-in', 'mcp-provided')),
  safety_level TEXT NOT NULL DEFAULT 'restricted'
    CHECK (safety_level IN ('safe', 'restricted', 'danger')),
  source_mcp_id TEXT,
  policy_version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO tools_new (
  id, name, description, input_schema, type, safety_level,
  source_mcp_id, policy_version, enabled, created_at, updated_at
)
SELECT
  id, name, description, input_schema, type,
  CASE
    WHEN type = 'mcp-provided' AND danger_level = 'low' THEN 'restricted'
    WHEN danger_level = 'low' THEN 'safe'
    WHEN danger_level = 'medium' THEN 'restricted'
    WHEN danger_level = 'high' THEN 'danger'
    ELSE 'restricted'
  END,
  source_mcp_id,
  printf('%s:%d', id, updated_at),
  enabled, created_at, updated_at
FROM tools;

DROP TABLE tools;
ALTER TABLE tools_new RENAME TO tools;
CREATE UNIQUE INDEX idx_tools_name_type_source
  ON tools(name, type, COALESCE(source_mcp_id, ''));

CREATE TABLE agent_tools_new (
  agent_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  safety_level TEXT NOT NULL DEFAULT 'inherit'
    CHECK (safety_level IN ('safe', 'restricted', 'danger', 'inherit')),
  PRIMARY KEY (agent_id, tool_id),
  FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
);

INSERT INTO agent_tools_new (agent_id, tool_id, safety_level)
SELECT agent_id, tool_id, 'inherit' FROM agent_tools;

DROP TABLE agent_tools;
ALTER TABLE agent_tools_new RENAME TO agent_tools;

CREATE TABLE jobs_new (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'running', 'waiting_confirmation', 'done', 'failed', 'cancelled')
  ),
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  leased_at INTEGER,
  lease_owner TEXT,
  error TEXT,
  result TEXT,
  session_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO jobs_new
SELECT * FROM jobs;

DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_session_id ON jobs(session_id);

CREATE TABLE tool_approvals (
  approval_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  job_id TEXT,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_source TEXT NOT NULL CHECK (tool_source IN ('built-in', 'mcp')),
  source_mcp_id TEXT,
  tool_call_id TEXT NOT NULL,
  arguments TEXT NOT NULL,
  arguments_digest TEXT NOT NULL,
  resource_scope TEXT NOT NULL,
  safety_level TEXT NOT NULL CHECK (safety_level IN ('restricted', 'danger')),
  policy_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')
  ),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE INDEX idx_tool_approvals_session ON tool_approvals(session_id, state);
CREATE INDEX idx_tool_approvals_job ON tool_approvals(job_id, state);
CREATE INDEX idx_tool_approvals_expiry ON tool_approvals(state, expires_at);
