import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScheduledTaskInput } from '@my-copilot/shared';
import { getDb, initDatabase } from '../../db/index.js';
import { createProvider } from '../../repo/provider.js';
import { createModel } from '../../repo/model.js';
import { createSession } from '../../repo/session.js';
import { createScheduledTask, setScheduledTaskStatus } from '../tasks.js';
describe('scheduled task validation and lifecycle', () => {
  let testDir: string; let modelId: string; let base: ScheduledTaskInput;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T00:00:00.000Z'));
    testDir = mkdtempSync(join(tmpdir(), 'scheduled-tasks-')); initDatabase(testDir);
    const provider = createProvider({ name: 'P', type: 'openai', baseUrl: 'https://example.com', apiKey: 'secret' });
    modelId = createModel(provider.id, { name: 'gpt-test' }).id;
    base = { name: '任务', prompt: '执行', scheduleType: 'once', runAt: Date.UTC(2026, 10, 1), cronExpression: null, timezone: 'Asia/Hong_Kong', targetType: 'new_session', targetSessionId: null, modelId, enforcedSkillIds: [] };
  });
  afterEach(() => { vi.useRealTimers(); try { getDb().close(); } catch { /* ignore */ } if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true, force: true }); });
  it('创建任务并计算下次时间', () => { const task = createScheduledTask(base); expect(task.id).toBeTruthy(); expect(task.nextRunAt).toBe(base.runAt); expect(task.status).toBe('active'); });
  it('已有会话目标必须存在', () => { const session = createSession({ title: '原对话', modelId }); const task = createScheduledTask({ ...base, targetType: 'existing_session', targetSessionId: session.id }); expect(task.targetSessionId).toBe(session.id); expect(() => createScheduledTask({ ...base, targetType: 'existing_session', targetSessionId: 'missing' })).toThrow('target_session_not_found'); });
  it('模型必须存在且启用', () => { expect(() => createScheduledTask({ ...base, modelId: 'missing' })).toThrow('model_not_found'); });
  it('拒绝过去的单次任务', () => { expect(() => createScheduledTask({ ...base, runAt: Date.now() - 1 })).toThrow('run_at_in_past'); });
  it('暂停恢复不补跑暂停期间 occurrence', () => { const task = createScheduledTask({ ...base, scheduleType: 'cron', runAt: null, cronExpression: '0 9 * * *' }); setScheduledTaskStatus(task.id, 'paused'); vi.setSystemTime(new Date('2026-11-03T00:00:00.000Z')); const resumed = setScheduledTaskStatus(task.id, 'active'); expect(resumed?.nextRunAt).toBe(Date.UTC(2026, 10, 3, 1)); });
});
