CREATE TABLE IF NOT EXISTS scheduled_task_drafts (
  id TEXT PRIMARY KEY,
  source_session_id TEXT NOT NULL,
  source_job_id TEXT,
  proposed_payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  confirmed_task_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (source_session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_job_id) REFERENCES jobs(id) ON DELETE SET NULL,
  FOREIGN KEY (confirmed_task_id) REFERENCES scheduled_tasks(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_scheduled_task_drafts_session
  ON scheduled_task_drafts(source_session_id, status, created_at DESC);
