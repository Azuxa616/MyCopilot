import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScheduledTaskInput } from '@my-copilot/shared';
import { getDb, initDatabase } from '../../db/index.js';
import { createProvider } from '../../repo/provider.js';
import { createModel } from '../../repo/model.js';
import { createSession, listSessions } from '../../repo/session.js';
import { listJobs } from '../../repo/job.js';
import { listScheduledTasks } from '../tasks.js';
import { cancelScheduledTaskDraft, confirmScheduledTaskDraft, getScheduledTaskDraft, proposeScheduledTask } from '../drafts.js';

describe('scheduled task drafts', () => {
  let testDir: string; let input: ScheduledTaskInput; let sourceSessionId: string;
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'scheduled-drafts-')); initDatabase(testDir);
    const provider = createProvider({ name: 'P', type: 'openai', baseUrl: 'https://example.com', apiKey: '' });
    const model = createModel(provider.id, { name: 'gpt-test' });
    sourceSessionId = createSession({ title: '来源', modelId: model.id }).id;
    input = { name: '任务', prompt: '执行', scheduleType: 'once', runAt: Date.now() + 60_000, cronExpression: null, timezone: 'Asia/Hong_Kong', targetType: 'new_session', targetSessionId: null, modelId: model.id, enforcedSkillIds: [] };
  });
  afterEach(() => { try { getDb().close(); } catch { /* ignore */ } if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true, force: true }); });

  it('提议只创建草稿，不创建正式任务、目标会话或 Job', () => {
    const sessions = listSessions().length;
    const draft = proposeScheduledTask(input, { sessionId: sourceSessionId });
    expect(draft.status).toBe('pending');
    expect(listScheduledTasks()).toHaveLength(0);
    expect(listSessions()).toHaveLength(sessions);
    expect(listJobs()).toHaveLength(0);
  });

  it('确认采用修改后的输入且重复确认幂等', () => {
    const draft = proposeScheduledTask(input, { sessionId: sourceSessionId });
    const first = confirmScheduledTaskDraft(draft.id, { ...input, name: '修改后的任务' });
    const second = confirmScheduledTaskDraft(draft.id, { ...input, name: '不应再次创建' });
    expect(first.task.name).toBe('修改后的任务');
    expect(second.task.id).toBe(first.task.id);
    expect(listScheduledTasks()).toHaveLength(1);
    expect(getScheduledTaskDraft(draft.id)?.confirmedTaskId).toBe(first.task.id);
  });

  it('取消草稿不创建任务', () => {
    const draft = proposeScheduledTask(input, { sessionId: sourceSessionId });
    cancelScheduledTaskDraft(draft.id);
    expect(getScheduledTaskDraft(draft.id)?.status).toBe('cancelled');
    expect(listScheduledTasks()).toHaveLength(0);
  });
});
