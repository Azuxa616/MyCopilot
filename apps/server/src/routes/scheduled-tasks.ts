import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ScheduledTaskInput } from '@my-copilot/shared';
import { HttpError } from '../middleware/error.js';
import { successResponse } from '../utils/response.js';
import { createScheduledTask, getScheduledTask, listScheduledTasks, setScheduledTaskStatus, softDeleteScheduledTask, updateScheduledTask } from '../scheduler/tasks.js';
import { runScheduledTaskNow } from '../scheduler/dispatch.js';
import { countUnreadScheduledTaskRuns, listScheduledTaskRunViews, markScheduledTaskRunRead, getScheduledTaskRun } from '../repo/scheduled-task.js';
import { now } from '../repo/base.js';

export const scheduledTasksApp = new Hono();
export const scheduledRunsApp = new Hono();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nullableNumber(value: unknown): value is number | null { return value === null || typeof value === 'number'; }
function nullableString(value: unknown): value is string | null { return value === null || typeof value === 'string'; }

function parseInput(value: unknown): ScheduledTaskInput {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.prompt !== 'string' ||
    (value.scheduleType !== 'once' && value.scheduleType !== 'cron') || !nullableNumber(value.runAt) ||
    !nullableString(value.cronExpression) || typeof value.timezone !== 'string' ||
    (value.targetType !== 'new_session' && value.targetType !== 'existing_session') ||
    !nullableString(value.targetSessionId) || typeof value.modelId !== 'string' ||
    !Array.isArray(value.enforcedSkillIds) || !value.enforcedSkillIds.every((id) => typeof id === 'string')) {
    throw new HttpError(400, 'invalid_scheduled_task_input');
  }
  return value as unknown as ScheduledTaskInput;
}

async function readInput(c: Context): Promise<ScheduledTaskInput> {
  try { return parseInput(await c.req.json()); } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'invalid_json');
  }
}

function mapError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'scheduled_task_not_found') throw new HttpError(404, message);
  if (message === 'scheduled_task_overlap') throw new HttpError(409, message);
  if (/^(name|prompt|run_at|cron_expression|invalid_|target_|model_|provider_|skill_)/.test(message)) {
    throw new HttpError(400, message);
  }
  throw error;
}

scheduledTasksApp.get('/', (c) => successResponse(c, listScheduledTasks()));
scheduledTasksApp.post('/', async (c) => {
  try { return successResponse(c, createScheduledTask(await readInput(c)), 201); } catch (error) { return mapError(error); }
});
scheduledTasksApp.get('/:id', (c) => {
  const task = getScheduledTask(c.req.param('id'));
  if (!task) throw new HttpError(404, 'scheduled_task_not_found');
  return successResponse(c, task);
});
scheduledTasksApp.patch('/:id', async (c) => {
  try {
    const task = updateScheduledTask(c.req.param('id'), await readInput(c));
    if (!task) throw new HttpError(404, 'scheduled_task_not_found');
    return successResponse(c, task);
  } catch (error) { return mapError(error); }
});
scheduledTasksApp.delete('/:id', (c) => {
  if (!softDeleteScheduledTask(c.req.param('id'))) throw new HttpError(404, 'scheduled_task_not_found');
  return successResponse(c, { deleted: true });
});
for (const [action, status] of [['pause', 'paused'], ['resume', 'active']] as const) {
  scheduledTasksApp.post(`/:id/${action}`, (c) => {
    try {
      const task = setScheduledTaskStatus(c.req.param('id'), status);
      if (!task) throw new HttpError(404, 'scheduled_task_not_found');
      return successResponse(c, task);
    } catch (error) { return mapError(error); }
  });
}
scheduledTasksApp.post('/:id/run', (c) => {
  try { return successResponse(c, runScheduledTaskNow(c.req.param('id'))); } catch (error) { return mapError(error); }
});
scheduledTasksApp.get('/:id/runs', (c) => {
  if (!getScheduledTask(c.req.param('id'))) throw new HttpError(404, 'scheduled_task_not_found');
  return successResponse(c, listScheduledTaskRunViews(c.req.param('id')));
});

scheduledRunsApp.get('/unread-count', (c) => successResponse(c, { count: countUnreadScheduledTaskRuns() }));
scheduledRunsApp.post('/:id/read', (c) => {
  if (!getScheduledTaskRun(c.req.param('id'))) throw new HttpError(404, 'scheduled_task_run_not_found');
  return successResponse(c, markScheduledTaskRunRead(c.req.param('id'), now()));
});

export { parseInput as parseScheduledTaskInput, mapError as mapScheduledTaskError, readInput as readScheduledTaskInput };
