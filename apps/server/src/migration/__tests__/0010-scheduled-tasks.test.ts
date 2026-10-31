import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, initDatabase } from '../../db/index.js';

function insertTask(id: string): void {
  getDb().prepare(`INSERT INTO scheduled_tasks (
    id, name, prompt, schedule_type, run_at, cron_expression, timezone,
    target_type, target_session_id, model_id, enforced_skill_ids,
    status, next_run_at, deleted_at, created_at, updated_at
  ) VALUES (?, '任务', '执行', 'cron', NULL, '0 9 * * *', 'Asia/Hong_Kong',
    'new_session', NULL, 'model-1', '[]', 'active', 100, NULL, 1, 1)`).run(id);
}

describe('migration 0010 scheduled tasks', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'migration-0010-'));
    initDatabase(testDir);
  });

  afterEach(() => {
    try { getDb().close(); } catch { /* already closed */ }
    if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('创建任务、运行记录与调度索引', () => {
    const tables = getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining(['scheduled_tasks', 'scheduled_task_runs']));
    const indexes = getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>;
    expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
      'idx_scheduled_tasks_due',
      'idx_scheduled_task_runs_task',
      'idx_scheduled_task_runs_job',
      'uq_scheduled_task_runs_occurrence',
    ]));
  });

  it('同一任务同一计划时间只允许一次，手动运行可重复', () => {
    insertTask('task-1');
    const insertRun = getDb().prepare(`INSERT INTO scheduled_task_runs (
      id, task_id, scheduled_for, trigger_type, job_id, session_id,
      user_message_id, assistant_message_id, dispatch_status,
      skipped_reason, dispatch_error, read_at, created_at
    ) VALUES (?, 'task-1', ?, ?, NULL, NULL, NULL, NULL, 'dispatched', NULL, NULL, NULL, 1)`);
    insertRun.run('run-1', 100, 'schedule');
    expect(() => insertRun.run('run-2', 100, 'schedule')).toThrow();
    insertRun.run('run-3', null, 'manual');
    insertRun.run('run-4', null, 'manual');
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM scheduled_task_runs').get()).toEqual({ count: 3 });
  });
});
