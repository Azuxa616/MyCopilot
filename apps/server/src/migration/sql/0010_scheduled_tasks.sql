-- 定时任务定义与运行记录。Job 表仍是 Agent 执行状态的唯一事实源。
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('once', 'cron')),
  run_at INTEGER,
  cron_expression TEXT,
  timezone TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('new_session', 'existing_session')),
  target_session_id TEXT,
  model_id TEXT NOT NULL,
  enforced_skill_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed')),
  next_run_at INTEGER,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (target_session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_due
  ON scheduled_tasks(status, next_run_at)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS scheduled_task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  scheduled_for INTEGER,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('schedule', 'catch_up', 'manual')),
  job_id TEXT,
  session_id TEXT,
  user_message_id TEXT,
  assistant_message_id TEXT,
  dispatch_status TEXT NOT NULL CHECK (dispatch_status IN ('dispatched', 'skipped', 'failed')),
  skipped_reason TEXT,
  dispatch_error TEXT,
  read_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (user_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  FOREIGN KEY (assistant_message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduled_task_runs_occurrence
  ON scheduled_task_runs(task_id, scheduled_for)
  WHERE scheduled_for IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_task
  ON scheduled_task_runs(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_job
  ON scheduled_task_runs(job_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_unread
  ON scheduled_task_runs(read_at, created_at DESC);
