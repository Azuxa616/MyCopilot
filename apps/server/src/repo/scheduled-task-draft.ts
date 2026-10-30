import type { ScheduledTaskDraft, ScheduledTaskInput } from '@my-copilot/shared';
import { getDb } from '../db/index.js';

interface DraftRow {
  id: string; source_session_id: string; source_job_id: string | null;
  proposed_payload: string; status: string; confirmed_task_id: string | null;
  created_at: number; updated_at: number;
}
function rowToDraft(row: DraftRow): ScheduledTaskDraft {
  return {
    id: row.id, sourceSessionId: row.source_session_id, sourceJobId: row.source_job_id,
    proposedPayload: JSON.parse(row.proposed_payload) as ScheduledTaskInput,
    status: row.status as ScheduledTaskDraft['status'], confirmedTaskId: row.confirmed_task_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
export function insertScheduledTaskDraft(draft: ScheduledTaskDraft): ScheduledTaskDraft {
  getDb().prepare(`INSERT INTO scheduled_task_drafts (
    id, source_session_id, source_job_id, proposed_payload, status, confirmed_task_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    draft.id, draft.sourceSessionId, draft.sourceJobId, JSON.stringify(draft.proposedPayload),
    draft.status, draft.confirmedTaskId, draft.createdAt, draft.updatedAt,
  );
  return draft;
}
export function getScheduledTaskDraftRecord(id: string): ScheduledTaskDraft | undefined {
  const row = getDb().prepare('SELECT * FROM scheduled_task_drafts WHERE id = ?').get(id) as DraftRow | undefined;
  return row ? rowToDraft(row) : undefined;
}
export function listScheduledTaskDraftRecords(sourceSessionId?: string): ScheduledTaskDraft[] {
  const rows = sourceSessionId
    ? getDb().prepare('SELECT * FROM scheduled_task_drafts WHERE source_session_id = ? ORDER BY created_at DESC').all(sourceSessionId)
    : getDb().prepare('SELECT * FROM scheduled_task_drafts ORDER BY created_at DESC').all();
  return (rows as DraftRow[]).map(rowToDraft);
}
export function updateScheduledTaskDraftRecord(draft: ScheduledTaskDraft): ScheduledTaskDraft {
  getDb().prepare(`UPDATE scheduled_task_drafts SET proposed_payload = ?, status = ?, confirmed_task_id = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(draft.proposedPayload), draft.status, draft.confirmedTaskId, draft.updatedAt, draft.id,
  );
  return draft;
}
