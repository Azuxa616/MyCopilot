import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScheduledTask } from '@my-copilot/shared';
import { getDb, initDatabase } from '../../db/index.js';
import { insertScheduledTask, insertScheduledTaskRun, listScheduledTaskListItems, listScheduledTaskRecords } from '../scheduled-task.js';
import { createSession } from '../session.js';

describe('scheduled task repository', () => {
  let testDir: string;
  beforeEach(() => { testDir = mkdtempSync(join(tmpdir(), 'scheduled-task-repo-')); initDatabase(testDir); });
  afterEach(() => {
    try { getDb().close(); } catch { /* ignore */ }
    if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('往返映射 JSON 与可空字段', () => {
    const task: ScheduledTask = {
      id: 'task-1', name: '任务', prompt: '执行', scheduleType: 'cron', runAt: null,
      cronExpression: '0 9 * * *', timezone: 'Asia/Hong_Kong', targetType: 'existing_session',
      targetSessionId: null, modelId: 'model-1', enforcedSkillIds: ['skill-a'], status: 'active',
      nextRunAt: 100, deletedAt: null, createdAt: 1, updatedAt: 1,
    };
    insertScheduledTask(task);
    expect(listScheduledTaskRecords()).toEqual([task]);
  });
});

describe('scheduled task list projection', () => {
  let testDir: string;
  beforeEach(() => { testDir = mkdtempSync(join(tmpdir(), 'scheduled-task-list-')); initDatabase(testDir); });
  afterEach(() => { try { getDb().close(); } catch { /* ignore */ } if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true, force: true }); });
  it('包含目标标题、最近运行和未读标记', () => {
    const session = createSession({ title: '原对话' });
    const task: ScheduledTask = { id: 'task-1', name: '任务', prompt: '执行', scheduleType: 'cron', runAt: null, cronExpression: '0 9 * * *', timezone: 'Asia/Hong_Kong', targetType: 'existing_session', targetSessionId: session.id, modelId: 'model-1', enforcedSkillIds: [], status: 'active', nextRunAt: 100, deletedAt: null, createdAt: 1, updatedAt: 1 };
    insertScheduledTask(task);
    insertScheduledTaskRun({ id: 'run-1', taskId: task.id, scheduledFor: 100, triggerType: 'schedule', jobId: null, sessionId: null, userMessageId: null, assistantMessageId: null, dispatchStatus: 'skipped', skippedReason: 'overlap', dispatchError: null, readAt: null, createdAt: 2 });
    expect(listScheduledTaskListItems()[0]).toEqual(expect.objectContaining({ targetSessionTitle: '原对话', lastRunStatus: 'skipped', lastRunAt: 2, hasUnread: true }));
  });
});
