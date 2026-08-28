-- Agent 评估结果：eval_runs（每个场景每次 trial 一行）。
-- 有意不设任何 UNIQUE 约束：确定性结果防重由 eval CLI「按 scenario 清旧插新」的
-- 替换语义保证（repo/eval.ts deleteEvalRuns），非 schema 约束。
CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('deterministic', 'live')),
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail')),
  trial INTEGER NOT NULL DEFAULT 1,
  metrics TEXT NOT NULL,
  fault_type TEXT,
  run_trace_id TEXT,
  assertion_results TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  FOREIGN KEY (run_trace_id) REFERENCES runs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_eval_runs_scenario_mode ON eval_runs(scenario_id, mode);
