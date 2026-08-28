-- Agent 执行轨迹：runs（Run 级汇总）与 run_steps（每步记录）。
-- 状态枚举与 shared/run.ts 的 RunStatus 逐字一致。
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT,
  agent_id TEXT,
  job_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'in_progress', 'requires_action', 'completed', 'cancelled', 'failed', 'incomplete', 'expired')),
  stop_reason TEXT,
  iterations INTEGER NOT NULL DEFAULT 0,
  budget_snapshot TEXT,
  degraded INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  error TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_runs_session_id ON runs(session_id);

CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('llm_call', 'tool_exec')),
  tool_name TEXT,
  args_preview TEXT,
  result_preview TEXT,
  is_error INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, seq),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_run_steps_run_id ON run_steps(run_id);
