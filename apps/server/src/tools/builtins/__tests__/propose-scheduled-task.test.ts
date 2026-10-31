import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, initDatabase } from '../../../db/index.js';
import { createProvider } from '../../../repo/provider.js';
import { createModel } from '../../../repo/model.js';
import { createSession } from '../../../repo/session.js';
import { createJob } from '../../../repo/job.js';
import { listScheduledTasks } from '../../../scheduler/tasks.js';
import { proposeScheduledTaskExecutor } from '../propose-scheduled-task.js';

describe('propose_scheduled_task tool', () => {
  let testDir: string; let sessionId: string; let modelId: string; let jobId: string;
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'propose-scheduled-tool-')); initDatabase(testDir);
    const provider = createProvider({ name: 'P', type: 'openai', baseUrl: 'https://example.com', apiKey: '' });
    modelId = createModel(provider.id, { name: 'gpt-test' }).id;
    sessionId = createSession({ title: '当前', modelId }).id;
    jobId = createJob({ type: 'agent-loop', payload: {}, sessionId }).id;
  });
  afterEach(() => { try { getDb().close(); } catch { /* ignore */ } if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true, force: true }); });

  it('默认依附当前会话并发出草稿事件，不正式创建', async () => {
    const onScheduledTaskDraft = vi.fn();
    const result = await proposeScheduledTaskExecutor.execute({
      name: '每日摘要', prompt: '总结最近消息', scheduleType: 'cron', cronExpression: '0 9 * * *', timezone: 'Asia/Hong_Kong',
    }, { sessionId, jobId, onScheduledTaskDraft });
    expect(result.isError).not.toBe(true);
    expect(onScheduledTaskDraft).toHaveBeenCalledWith(expect.objectContaining({
      sourceSessionId: sessionId, sourceJobId: jobId,
      proposedPayload: expect.objectContaining({ targetType: 'existing_session', targetSessionId: sessionId, modelId }),
    }));
    expect(listScheduledTasks()).toHaveLength(0);
  });
});
