import type { ScheduledTask, ScheduledTaskRun, ScheduledTaskRunView } from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { getJob } from './job.js';

interface ScheduledTaskRow {
  id: string; name: string; prompt: string; schedule_type: string; run_at: number | null;
  cron_expression: string | null; timezone: string; target_type: string;
  target_session_id: string | null; model_id: string; enforced_skill_ids: string;
  status: string; next_run_at: number | null; deleted_at: number | null;
  created_at: number; updated_at: number;
}

export interface ScheduledTaskRunRow {
  id: string; task_id: string; scheduled_for: number | null; trigger_type: string;
  job_id: string | null; session_id: string | null; user_message_id: string | null;
  assistant_message_id: string | null; dispatch_status: string; skipped_reason: string | null;
  dispatch_error: string | null; read_at: number | null; created_at: number;
}

function parseStringArray(raw: string): string[] {
  try { const value = JSON.parse(raw); return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []; } catch { return []; }
}

function rowToTask(row: ScheduledTaskRow): ScheduledTask {
  return {
    id: row.id, name: row.name, prompt: row.prompt,
    scheduleType: row.schedule_type as ScheduledTask['scheduleType'], runAt: row.run_at,
    cronExpression: row.cron_expression, timezone: row.timezone,
    targetType: row.target_type as ScheduledTask['targetType'], targetSessionId: row.target_session_id,
    modelId: row.model_id, enforcedSkillIds: parseStringArray(row.enforced_skill_ids),
    status: row.status as ScheduledTask['status'], nextRunAt: row.next_run_at,
    deletedAt: row.deleted_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function rowToScheduledTaskRun(row: ScheduledTaskRunRow): ScheduledTaskRun {
  return {
    id: row.id, taskId: row.task_id, scheduledFor: row.scheduled_for,
    triggerType: row.trigger_type as ScheduledTaskRun['triggerType'], jobId: row.job_id,
    sessionId: row.session_id, userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    dispatchStatus: row.dispatch_status as ScheduledTaskRun['dispatchStatus'],
    skippedReason: row.skipped_reason, dispatchError: row.dispatch_error,
    readAt: row.read_at, createdAt: row.created_at,
  };
}

export function insertScheduledTask(task: ScheduledTask): ScheduledTask {
  getDb().prepare(`INSERT INTO scheduled_tasks (
    id, name, prompt, schedule_type, run_at, cron_expression, timezone, target_type,
    target_session_id, model_id, enforced_skill_ids, status, next_run_at, deleted_at,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    task.id, task.name, task.prompt, task.scheduleType, task.runAt, task.cronExpression,
    task.timezone, task.targetType, task.targetSessionId, task.modelId,
    JSON.stringify(task.enforcedSkillIds), task.status, task.nextRunAt, task.deletedAt,
    task.createdAt, task.updatedAt,
  );
  return task;
}

export function getScheduledTaskRecord(id: string): ScheduledTask | undefined {
  const row = getDb().prepare('SELECT * FROM scheduled_tasks WHERE id = ? AND deleted_at IS NULL').get(id) as ScheduledTaskRow | undefined;
  return row ? rowToTask(row) : undefined;
}

export function listScheduledTaskRecords(): ScheduledTask[] {
  const rows = getDb().prepare('SELECT * FROM scheduled_tasks WHERE deleted_at IS NULL ORDER BY created_at DESC').all() as ScheduledTaskRow[];
  return rows.map(rowToTask);
}

export function updateScheduledTaskRecord(task: ScheduledTask): ScheduledTask {
  getDb().prepare(`UPDATE scheduled_tasks SET name = ?, prompt = ?, schedule_type = ?, run_at = ?,
    cron_expression = ?, timezone = ?, target_type = ?, target_session_id = ?, model_id = ?,
    enforced_skill_ids = ?, status = ?, next_run_at = ?, deleted_at = ?, updated_at = ? WHERE id = ?`).run(
    task.name, task.prompt, task.scheduleType, task.runAt, task.cronExpression, task.timezone,
    task.targetType, task.targetSessionId, task.modelId, JSON.stringify(task.enforcedSkillIds),
    task.status, task.nextRunAt, task.deletedAt, task.updatedAt, task.id,
  );
  return task;
}

export function toScheduledTaskRunView(run: ScheduledTaskRun): ScheduledTaskRunView {
  const status = run.dispatchStatus === 'skipped'
    ? 'skipped'
    : run.dispatchStatus === 'failed'
      ? 'dispatch_failed'
      : run.jobId ? getJob(run.jobId)?.status ?? 'dispatch_failed' : 'dispatch_failed';
  return { ...run, status };
}

export function listDueScheduledTaskRecords(at: number, limit = 20): ScheduledTask[] {
  const rows = getDb().prepare(`SELECT * FROM scheduled_tasks
    WHERE deleted_at IS NULL AND status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ?
    ORDER BY next_run_at ASC LIMIT ?`).all(at, limit) as ScheduledTaskRow[];
  return rows.map(rowToTask);
}

export function insertScheduledTaskRun(run: ScheduledTaskRun): ScheduledTaskRun {
  getDb().prepare(`INSERT INTO scheduled_task_runs (
    id, task_id, scheduled_for, trigger_type, job_id, session_id, user_message_id,
    assistant_message_id, dispatch_status, skipped_reason, dispatch_error, read_at, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    run.id, run.taskId, run.scheduledFor, run.triggerType, run.jobId, run.sessionId,
    run.userMessageId, run.assistantMessageId, run.dispatchStatus, run.skippedReason,
    run.dispatchError, run.readAt, run.createdAt,
  );
  return run;
}

export function getScheduledTaskRun(id: string): ScheduledTaskRunView | undefined {
  const row = getDb().prepare('SELECT * FROM scheduled_task_runs WHERE id = ?').get(id) as ScheduledTaskRunRow | undefined;
  return row ? toScheduledTaskRunView(rowToScheduledTaskRun(row)) : undefined;
}

export function listScheduledTaskRunViews(taskId: string): ScheduledTaskRunView[] {
  const rows = getDb().prepare('SELECT * FROM scheduled_task_runs WHERE task_id = ? ORDER BY created_at DESC, id DESC').all(taskId) as ScheduledTaskRunRow[];
  return rows.map((row) => toScheduledTaskRunView(rowToScheduledTaskRun(row)));
}

export function hasActiveScheduledTaskRun(taskId: string): boolean {
  const row = getDb().prepare(`SELECT r.id FROM scheduled_task_runs r
    JOIN jobs j ON j.id = r.job_id
    WHERE r.task_id = ? AND r.dispatch_status = 'dispatched'
      AND j.status IN ('pending', 'running', 'waiting_confirmation') LIMIT 1`).get(taskId);
  return row !== undefined;
}

export function countUnreadScheduledTaskRuns(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS count FROM scheduled_task_runs r
    LEFT JOIN jobs j ON j.id = r.job_id
    WHERE r.read_at IS NULL AND (
      r.dispatch_status IN ('skipped', 'failed')
      OR j.status IN ('waiting_confirmation', 'done', 'failed', 'cancelled')
    )`).get() as { count: number };
  return row.count;
}

export function markScheduledTaskRunRead(id: string, at: number): ScheduledTaskRunView | undefined {
  getDb().prepare('UPDATE scheduled_task_runs SET read_at = ? WHERE id = ? AND read_at IS NULL').run(at, id);
  return getScheduledTaskRun(id);
}
