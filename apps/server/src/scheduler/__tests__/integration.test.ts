import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, initDatabase } from '../../db/index.js';
import { createProvider } from '../../repo/provider.js';
import { createModel } from '../../repo/model.js';
import { createScheduledTask } from '../tasks.js';
import { dispatchDueScheduledTasks } from '../dispatch.js';
import { listScheduledTaskRunViews } from '../../repo/scheduled-task.js';
import { claimJob, getJob } from '../../repo/job.js';
import { clearJobHandlers, processJob, registerJobHandler } from '../../jobs/worker.js';

describe('scheduled job integration', () => {
  let testDir: string;
  beforeEach(() => { testDir = mkdtempSync(join(tmpdir(), 'scheduled-integration-')); initDatabase(testDir); });
  afterEach(() => { clearJobHandlers(); try { getDb().close(); } catch { /* ignore */ } if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true, force: true }); });
  it('调度生成的 Job 可由现有 Worker 完成', async () => {
    const provider = createProvider({ name: 'P', type: 'openai', baseUrl: 'https://example.com', apiKey: '' });
    const model = createModel(provider.id, { name: 'gpt-test' });
    const task = createScheduledTask({ name: '任务', prompt: '执行', scheduleType: 'once', runAt: Date.now() + 1000, cronExpression: null, timezone: 'Asia/Hong_Kong', targetType: 'new_session', targetSessionId: null, modelId: model.id, enforcedSkillIds: [] });
    dispatchDueScheduledTasks(task.nextRunAt!);
    const run = listScheduledTaskRunViews(task.id)[0]!;
    registerJobHandler('agent-loop', async () => ({ ok: true }));
    await processJob(claimJob('integration-test')!);
    expect(getJob(run.jobId!)?.status).toBe('done');
  });
});
