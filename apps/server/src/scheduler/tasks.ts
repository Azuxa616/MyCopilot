import type { ScheduledTask, ScheduledTaskInput } from '@my-copilot/shared';
import { generateId, now } from '../repo/base.js';
import { getModel } from '../repo/model.js';
import { getProvider } from '../repo/provider.js';
import { getSession } from '../repo/session.js';
import { getSkillMeta } from '../repo/skill.js';
import {
  getScheduledTaskRecord,
  insertScheduledTask,
  listScheduledTaskRecords,
  updateScheduledTaskRecord,
} from '../repo/scheduled-task.js';
import { getNextRunAt } from './calculate-next-run.js';

export function validateScheduledTaskReferences(input: ScheduledTaskInput): void {
  if (!input.name.trim()) throw new Error('name_required');
  if (!input.prompt.trim()) throw new Error('prompt_required');
  if (input.targetType === 'existing_session') {
    if (!input.targetSessionId || !getSession(input.targetSessionId)) throw new Error('target_session_not_found');
  } else if (input.targetSessionId !== null) throw new Error('target_session_must_be_null');
  const model = getModel(input.modelId);
  if (!model) throw new Error('model_not_found');
  if (!model.enabled) throw new Error('model_disabled');
  const provider = getProvider(model.providerId);
  if (!provider) throw new Error('provider_not_found');
  if (!provider.enabled) throw new Error('provider_disabled');
  for (const skillId of input.enforcedSkillIds) {
    const skill = getSkillMeta(skillId);
    if (!skill) throw new Error('skill_not_found');
    if (!skill.enabled) throw new Error('skill_disabled');
  }
}

function validateScheduledTaskInput(input: ScheduledTaskInput, at = now()): void {
  validateScheduledTaskReferences(input);
  const next = getNextRunAt(input, at);
  if (next === null) throw new Error('run_at_in_past');
}

export function createScheduledTask(input: ScheduledTaskInput): ScheduledTask {
  const ts = now();
  validateScheduledTaskInput(input, ts);
  const task: ScheduledTask = {
    ...input, name: input.name.trim(), prompt: input.prompt.trim(), id: generateId(),
    status: 'active', nextRunAt: getNextRunAt(input, ts), deletedAt: null,
    createdAt: ts, updatedAt: ts,
  };
  return insertScheduledTask(task);
}

export function updateScheduledTask(id: string, input: ScheduledTaskInput): ScheduledTask | undefined {
  const existing = getScheduledTaskRecord(id);
  if (!existing) return undefined;
  const ts = now();
  validateScheduledTaskInput(input, ts);
  return updateScheduledTaskRecord({
    ...existing, ...input, name: input.name.trim(), prompt: input.prompt.trim(),
    status: existing.status === 'paused' ? 'paused' : 'active',
    nextRunAt: getNextRunAt(input, ts), updatedAt: ts,
  });
}

export function getScheduledTask(id: string): ScheduledTask | undefined {
  return getScheduledTaskRecord(id);
}

export function listScheduledTasks(): ScheduledTask[] {
  return listScheduledTaskRecords();
}

export function setScheduledTaskStatus(id: string, status: 'active' | 'paused'): ScheduledTask | undefined {
  const task = getScheduledTaskRecord(id);
  if (!task) return undefined;
  const nextRunAt = status === 'active' ? getNextRunAt(task, now()) : task.nextRunAt;
  if (status === 'active' && nextRunAt === null) throw new Error('run_at_in_past');
  return updateScheduledTaskRecord({ ...task, status, nextRunAt, updatedAt: now() });
}

export function softDeleteScheduledTask(id: string): boolean {
  const task = getScheduledTaskRecord(id);
  if (!task) return false;
  updateScheduledTaskRecord({ ...task, deletedAt: now(), nextRunAt: null, updatedAt: now() });
  return true;
}
