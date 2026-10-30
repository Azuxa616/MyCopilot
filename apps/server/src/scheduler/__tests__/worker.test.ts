import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, initDatabase } from '../../db/index.js';
import { createProvider } from '../../repo/provider.js';
import { createModel } from '../../repo/model.js';
import { createScheduledTask } from '../tasks.js';
import { listScheduledTaskRunViews } from '../../repo/scheduled-task.js';
import { startScheduler, stopScheduler } from '../worker.js';

describe('scheduler worker', () => {
  let testDir: string;
  beforeEach(() => { vi.useFakeTimers(); testDir = mkdtempSync(join(tmpdir(), 'scheduler-worker-')); initDatabase(testDir); });
  afterEach(() => { stopScheduler(); vi.useRealTimers(); try { getDb().close(); } catch { /* ignore */ } if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true, force: true }); });
  it('启动后轮询到期任务，停止后不再分发', async () => {
    const provider = createProvider({ name: 'P', type: 'openai', baseUrl: 'https://example.com', apiKey: '' });
    const model = createModel(provider.id, { name: 'gpt-test' });
    const task = createScheduledTask({ name: '任务', prompt: '执行', scheduleType: 'once', runAt: Date.now() + 1000, cronExpression: null, timezone: 'Asia/Hong_Kong', targetType: 'new_session', targetSessionId: null, modelId: model.id, enforcedSkillIds: [] });
    startScheduler();
    await vi.advanceTimersByTimeAsync(1100);
    expect(listScheduledTaskRunViews(task.id)).toHaveLength(1);
    stopScheduler();
    await vi.advanceTimersByTimeAsync(5000);
    expect(listScheduledTaskRunViews(task.id)).toHaveLength(1);
  });
});
