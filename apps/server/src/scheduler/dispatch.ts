import type { Message, ScheduledTask, ScheduledTaskRun, ScheduledTaskRunView, ScheduledTaskTriggerType } from '@my-copilot/shared';
import { generateId, now, withTransaction } from '../repo/base.js';
import { getModel } from '../repo/model.js';
import { getProvider } from '../repo/provider.js';
import { createSession, getSession } from '../repo/session.js';
import { listMessagesBySession } from '../repo/message.js';
import {
  getScheduledTaskRecord,
  getScheduledTaskRun,
  hasActiveScheduledTaskRun,
  insertScheduledTaskRun,
  listDueScheduledTaskRecords,
  updateScheduledTaskRecord,
} from '../repo/scheduled-task.js';
import { enqueueAgentLoop } from '../jobs/enqueue-agent-loop.js';
import { getLatestRunAt, getNextRunAt } from './calculate-next-run.js';
import { validateScheduledTaskReferences } from './tasks.js';

interface DispatchResult {
  kind: 'dispatched' | 'skipped' | 'failed';
  run?: ScheduledTaskRunView;
}

function advanceAfterOccurrence(task: ScheduledTask, at: number): void {
  updateScheduledTaskRecord({
    ...task,
    status: task.scheduleType === 'once' ? 'completed' : 'active',
    nextRunAt: task.scheduleType === 'once' ? null : getNextRunAt(task, at),
    updatedAt: now(),
  });
}

function makeRun(task: ScheduledTask, scheduledFor: number | null, triggerType: ScheduledTaskTriggerType, at: number): ScheduledTaskRun {
  return {
    id: generateId(), taskId: task.id, scheduledFor, triggerType, jobId: null, sessionId: null,
    userMessageId: null, assistantMessageId: null, dispatchStatus: 'dispatched',
    skippedReason: null, dispatchError: null, readAt: null, createdAt: at,
  };
}

function dispatchOne(task: ScheduledTask, scheduledFor: number | null, triggerType: ScheduledTaskTriggerType, at: number, automatic: boolean): DispatchResult {
  return withTransaction((): DispatchResult => {
    const current = getScheduledTaskRecord(task.id);
    if (!current) return { kind: 'failed' };
    if (automatic && (current.status !== 'active' || current.nextRunAt !== task.nextRunAt)) return { kind: 'failed' };
    const run = makeRun(current, scheduledFor, triggerType, at);

    if (hasActiveScheduledTaskRun(current.id)) {
      if (!automatic) throw new Error('scheduled_task_overlap');
      run.dispatchStatus = 'skipped';
      run.skippedReason = 'overlap';
      insertScheduledTaskRun(run);
      advanceAfterOccurrence(current, at);
      return { kind: 'skipped', run: getScheduledTaskRun(run.id) };
    }

    try {
      validateScheduledTaskReferences(current);
    } catch (error) {
      run.dispatchStatus = 'failed';
      run.dispatchError = error instanceof Error ? error.message : String(error);
      insertScheduledTaskRun(run);
      updateScheduledTaskRecord({ ...current, status: 'paused', nextRunAt: null, updatedAt: now() });
      return { kind: 'failed', run: getScheduledTaskRun(run.id) };
    }

    const model = getModel(current.modelId)!;
    const provider = getProvider(model.providerId)!;
    let sessionId: string;
    let history: Message[];
    if (current.targetType === 'new_session') {
      const localTime = new Intl.DateTimeFormat('zh-CN', { timeZone: current.timezone, dateStyle: 'short', timeStyle: 'short' }).format(at);
      sessionId = createSession({ title: `${current.name} · ${localTime}`, modelId: current.modelId }).id;
      history = [];
    } else {
      sessionId = current.targetSessionId!;
      getSession(sessionId);
      history = listMessagesBySession(sessionId);
    }
    const userMessage: Message = {
      id: '', sessionId, role: 'user', content: current.prompt, attachments: [],
      status: 'sent', createdAt: at,
    };
    const queued = enqueueAgentLoop({
      sessionId, userMessage, provider, model, history,
      enforcedSkillIds: current.enforcedSkillIds,
    });
    run.jobId = queued.job.id;
    run.sessionId = sessionId;
    run.userMessageId = queued.userMessage.id;
    run.assistantMessageId = queued.assistantMessage.id;
    insertScheduledTaskRun(run);
    if (automatic) advanceAfterOccurrence(current, at);
    return { kind: 'dispatched', run: getScheduledTaskRun(run.id) };
  });
}

export function dispatchDueScheduledTasks(at: number = Date.now()): { dispatched: number; skipped: number; failed: number } {
  const result = { dispatched: 0, skipped: 0, failed: 0 };
  const dueTasks = listDueScheduledTaskRecords(at);
  for (const task of dueTasks) {
    const scheduledFor = getLatestRunAt(task, at) ?? task.nextRunAt;
    const triggerType = task.nextRunAt! < at ? 'catch_up' : 'schedule';
    try {
      const dispatched = dispatchOne(task, scheduledFor, triggerType, at, true);
      if (dispatched.run) result[dispatched.kind] += 1;
    } catch (error) {
      console.error(`[scheduler] failed to dispatch task ${task.id}:`, error);
      result.failed += 1;
    }
  }
  return result;
}

export function runScheduledTaskNow(id: string): ScheduledTaskRunView {
  const task = getScheduledTaskRecord(id);
  if (!task) throw new Error('scheduled_task_not_found');
  const result = dispatchOne(task, null, 'manual', Date.now(), false);
  if (!result.run) throw new Error('scheduled_task_dispatch_failed');
  return result.run;
}

