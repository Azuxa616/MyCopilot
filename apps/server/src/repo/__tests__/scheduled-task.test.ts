import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScheduledTask } from '@my-copilot/shared';
import { getDb, initDatabase } from '../../db/index.js';
import { insertScheduledTask, listScheduledTaskRecords } from '../scheduled-task.js';

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
