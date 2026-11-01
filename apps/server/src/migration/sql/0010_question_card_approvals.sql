CREATE TABLE tool_approvals_new (
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
  safety_level TEXT NOT NULL CHECK (safety_level IN ('safe', 'restricted', 'danger')),
  policy_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

INSERT INTO tool_approvals_new SELECT * FROM tool_approvals;
DROP TABLE tool_approvals;
ALTER TABLE tool_approvals_new RENAME TO tool_approvals;
CREATE INDEX idx_tool_approvals_session ON tool_approvals(session_id, state);
CREATE INDEX idx_tool_approvals_job ON tool_approvals(job_id, state);
CREATE INDEX idx_tool_approvals_expiry ON tool_approvals(state, expires_at);
