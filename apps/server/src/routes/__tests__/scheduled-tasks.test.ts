import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScheduledTask, ScheduledTaskInput } from '@my-copilot/shared';
import { errorMiddleware } from '../../middleware/error.js';
import { getDb, initDatabase } from '../../db/index.js';
import { createProvider } from '../../repo/provider.js';
import { createModel } from '../../repo/model.js';
import { claimJob, completeJob } from '../../repo/job.js';
import { scheduledTasksApp, scheduledRunsApp } from '../scheduled-tasks.js';

function app(): Hono {
  const value = new Hono();
  value.onError(errorMiddleware());
  value.route('/scheduled-tasks', scheduledTasksApp);
  value.route('/scheduled-runs', scheduledRunsApp);
  return value;
}
async function json(res: Response): Promise<any> { return res.json(); }

describe('scheduled task routes', () => {
  let testDir: string; let input: ScheduledTaskInput;
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'scheduled-routes-')); initDatabase(testDir);
    const provider = createProvider({ name: 'P', type: 'openai', baseUrl: 'https://example.com', apiKey: '' });
    const model = createModel(provider.id, { name: 'gpt-test' });
    input = { name: '任务', prompt: '执行', scheduleType: 'once', runAt: Date.now() + 60_000, cronExpression: null, timezone: 'Asia/Hong_Kong', targetType: 'new_session', targetSessionId: null, modelId: model.id, enforcedSkillIds: [] };
  });
  afterEach(() => { try { getDb().close(); } catch { /* ignore */ } if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true, force: true }); });

  async function create(): Promise<ScheduledTask> {
    const res = await app().request('/scheduled-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    expect(res.status).toBe(201);
    return (await json(res)).data;
  }

  it('支持创建、列表、详情、编辑和软删除', async () => {
    const task = await create();
    expect((await app().request('/scheduled-tasks')).status).toBe(200);
    expect((await json(await app().request(`/scheduled-tasks/${task.id}`))).data.id).toBe(task.id);
    const updated = await app().request(`/scheduled-tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, name: '新名称' }) });
    expect((await json(updated)).data.name).toBe('新名称');
    expect((await app().request(`/scheduled-tasks/${task.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app().request(`/scheduled-tasks/${task.id}`)).status).toBe(404);
  });

  it('无效输入返回 400，不存在返回 404', async () => {
    const bad = await app().request('/scheduled-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '缺字段' }) });
    expect(bad.status).toBe(400);
    expect((await app().request('/scheduled-tasks/missing')).status).toBe(404);
  });

  it('暂停和恢复改变任务状态', async () => {
    const task = await create();
    expect((await json(await app().request(`/scheduled-tasks/${task.id}/pause`, { method: 'POST' }))).data.status).toBe('paused');
    expect((await json(await app().request(`/scheduled-tasks/${task.id}/resume`, { method: 'POST' }))).data.status).toBe('active');
  });

  it('立即运行、历史和重叠 409', async () => {
    const task = await create();
    const runRes = await app().request(`/scheduled-tasks/${task.id}/run`, { method: 'POST' });
    expect(runRes.status).toBe(200);
    const run = (await json(runRes)).data;
    expect(run.triggerType).toBe('manual');
    expect((await app().request(`/scheduled-tasks/${task.id}/run`, { method: 'POST' })).status).toBe(409);
    const history = await json(await app().request(`/scheduled-tasks/${task.id}/runs`));
    expect(history.data).toHaveLength(1);
  });

  it('完成结果计入未读，标记后清零', async () => {
    const task = await create();
    await app().request(`/scheduled-tasks/${task.id}/run`, { method: 'POST' });
    const claimed = claimJob('route-test')!;
    completeJob(claimed.id, { content: '完成' });
    expect((await json(await app().request('/scheduled-runs/unread-count'))).data.count).toBe(1);
    const runs = (await json(await app().request(`/scheduled-tasks/${task.id}/runs`))).data;
    expect((await app().request(`/scheduled-runs/${runs[0].id}/read`, { method: 'POST' })).status).toBe(200);
    expect((await json(await app().request('/scheduled-runs/unread-count'))).data.count).toBe(0);
  });
});
