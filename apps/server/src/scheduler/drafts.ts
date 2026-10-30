import type { ScheduledTask, ScheduledTaskDraft, ScheduledTaskInput } from '@my-copilot/shared';
import type { ToolExecutionContext } from '../tools/registry.js';
import { generateId, now, withTransaction } from '../repo/base.js';
import { getScheduledTaskDraftRecord, insertScheduledTaskDraft, listScheduledTaskDraftRecords, updateScheduledTaskDraftRecord } from '../repo/scheduled-task-draft.js';
import { createScheduledTask, getScheduledTask, validateScheduledTaskReferences } from './tasks.js';
import { getNextRunAt } from './calculate-next-run.js';

export function proposeScheduledTask(input: ScheduledTaskInput, context: Pick<ToolExecutionContext, 'sessionId' | 'jobId'>): ScheduledTaskDraft {
  validateScheduledTaskReferences(input);
  if (getNextRunAt(input, now()) === null) throw new Error('run_at_in_past');
  const ts = now();
  return insertScheduledTaskDraft({
    id: generateId(), sourceSessionId: context.sessionId, sourceJobId: context.jobId ?? null,
    proposedPayload: input, status: 'pending', confirmedTaskId: null, createdAt: ts, updatedAt: ts,
  });
}

export function getScheduledTaskDraft(id: string): ScheduledTaskDraft | undefined {
  return getScheduledTaskDraftRecord(id);
}
export function listScheduledTaskDrafts(sourceSessionId?: string): ScheduledTaskDraft[] {
  return listScheduledTaskDraftRecords(sourceSessionId);
}
export function confirmScheduledTaskDraft(id: string, input: ScheduledTaskInput): { draft: ScheduledTaskDraft; task: ScheduledTask } {
  return withTransaction(() => {
    const existing = getScheduledTaskDraftRecord(id);
    if (!existing) throw new Error('scheduled_task_draft_not_found');
    if (existing.status === 'confirmed' && existing.confirmedTaskId) {
      const task = getScheduledTask(existing.confirmedTaskId);
      if (task) return { draft: existing, task };
    }
    if (existing.status !== 'pending') throw new Error('scheduled_task_draft_not_pending');
    const task = createScheduledTask(input);
    const draft = updateScheduledTaskDraftRecord({ ...existing, status: 'confirmed', confirmedTaskId: task.id, updatedAt: now() });
    return { draft, task };
  });
}
export function cancelScheduledTaskDraft(id: string): ScheduledTaskDraft | undefined {
  const draft = getScheduledTaskDraftRecord(id);
  if (!draft) return undefined;
  if (draft.status !== 'pending') return draft;
  return updateScheduledTaskDraftRecord({ ...draft, status: 'cancelled', updatedAt: now() });
}
