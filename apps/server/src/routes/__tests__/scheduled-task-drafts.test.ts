import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScheduledTask, ScheduledTaskDraft, ScheduledTaskInput } from '@my-copilot/shared';
import { errorMiddleware } from '../../middleware/error.js';
import { getDb, initDatabase } from '../../db/index.js';
import { createProvider } from '../../repo/provider.js';
import { createModel } from '../../repo/model.js';
import { createSession } from '../../repo/session.js';
import { proposeScheduledTask } from '../../scheduler/drafts.js';
import { scheduledTaskDraftsApp } from '../scheduled-task-drafts.js';

describe('scheduled task draft routes', () => {
  let testDir: string; let input: ScheduledTaskInput; let draftId: string;
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'scheduled-draft-routes-')); initDatabase(testDir);
    const provider = createProvider({ name: 'P', type: 'openai', baseUrl: 'https://example.com', apiKey: '' });
    const model = createModel(provider.id, { name: 'gpt-test' });
    const session = createSession({ title: '来源', modelId: model.id });
    input = { name: '任务', prompt: '执行', scheduleType: 'once', runAt: Date.now() + 60_000, cronExpression: null, timezone: 'Asia/Hong_Kong', targetType: 'new_session', targetSessionId: null, modelId: model.id, enforcedSkillIds: [] };
    draftId = proposeScheduledTask(input, { sessionId: session.id }).id;
  });
  afterEach(() => { try { getDb().close(); } catch { /* ignore */ } if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true, force: true }); });
  function app(): Hono { const app = new Hono(); app.onError(errorMiddleware()); app.route('/', scheduledTaskDraftsApp); return app; }

  it('读取、编辑确认并幂等返回任务', async () => {
    expect((await app().request(`/${draftId}`)).status).toBe(200);
    const confirm = () => app().request(`/${draftId}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, name: '最终名称' }) });
    const first = await confirm();
    expect(first.status).toBe(200);
    const body = await first.json() as { data: { draft: ScheduledTaskDraft; task: ScheduledTask } };
    expect(body.data.task.name).toBe('最终名称');
    const second = await confirm();
    expect((await second.json() as { data: { task: ScheduledTask } }).data.task.id).toBe(body.data.task.id);
  });

  it('取消后不能确认', async () => {
    expect((await app().request(`/${draftId}/cancel`, { method: 'POST' })).status).toBe(200);
    expect((await app().request(`/${draftId}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).status).toBe(409);
  });
});
