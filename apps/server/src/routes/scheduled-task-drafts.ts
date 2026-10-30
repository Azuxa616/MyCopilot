import { Hono } from 'hono';
import { HttpError } from '../middleware/error.js';
import { successResponse } from '../utils/response.js';
import { cancelScheduledTaskDraft, confirmScheduledTaskDraft, getScheduledTaskDraft, listScheduledTaskDrafts } from '../scheduler/drafts.js';
import { mapScheduledTaskError, readScheduledTaskInput } from './scheduled-tasks.js';

export const scheduledTaskDraftsApp = new Hono();

scheduledTaskDraftsApp.get('/', (c) => successResponse(c, listScheduledTaskDrafts(c.req.query('session_id'))));
scheduledTaskDraftsApp.get('/:id', (c) => {
  const draft = getScheduledTaskDraft(c.req.param('id'));
  if (!draft) throw new HttpError(404, 'scheduled_task_draft_not_found');
  return successResponse(c, draft);
});
scheduledTaskDraftsApp.post('/:id/confirm', async (c) => {
  try {
    return successResponse(c, confirmScheduledTaskDraft(c.req.param('id'), await readScheduledTaskInput(c)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'scheduled_task_draft_not_found') throw new HttpError(404, message);
    if (message === 'scheduled_task_draft_not_pending') throw new HttpError(409, message);
    return mapScheduledTaskError(error);
  }
});
scheduledTaskDraftsApp.post('/:id/cancel', (c) => {
  const draft = cancelScheduledTaskDraft(c.req.param('id'));
  if (!draft) throw new HttpError(404, 'scheduled_task_draft_not_found');
  return successResponse(c, draft);
});
