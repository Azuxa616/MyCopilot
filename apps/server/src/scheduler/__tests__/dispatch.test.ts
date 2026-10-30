import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScheduledTaskInput } from '@my-copilot/shared';
import { getDb, initDatabase } from '../../db/index.js';
import { createProvider } from '../../repo/provider.js';
import { createModel } from '../../repo/model.js';
import { createSession, getSession } from '../../repo/session.js';
import { createMessage, listMessagesBySession } from '../../repo/message.js';
import { listJobsBySession } from '../../repo/job.js';
import { createScheduledTask, getScheduledTask } from '../tasks.js';
import { dispatchDueScheduledTasks, runScheduledTaskNow } from '../dispatch.js';
import { listScheduledTaskRunViews } from '../../repo/scheduled-task.js';

const NOW = Date.UTC(2026, 9, 29, 0, 0, 0);
describe('scheduled task dispatch', () => {
  let testDir: string; let modelId: string; let base: ScheduledTaskInput;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    testDir = mkdtempSync(join(tmpdir(), 'scheduled-dispatch-')); initDatabase(testDir);
    const provider = createProvider({ name: 'P', type: 'openai', baseUrl: 'https://example.com', apiKey: 'secret' });
    modelId = createModel(provider.id, { name: 'gpt-test' }).id;
    base = { name: '任务', prompt: '执行', scheduleType: 'cron', runAt: null, cronExpression: '0 9 * * *', timezone: 'Asia/Hong_Kong', targetType: 'new_session', targetSessionId: null, modelId, enforcedSkillIds: [] };
  });
  afterEach(() => { vi.useRealTimers(); try { getDb().close(); } catch { /* ignore */ } if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true, force: true }); });

  it('单次任务创建新会话、消息和 Job 后完成调度', () => {
    const runAt = NOW + 1000;
    const task = createScheduledTask({ ...base, scheduleType: 'once', runAt, cronExpression: null });
    expect(dispatchDueScheduledTasks(runAt)).toEqual({ dispatched: 1, skipped: 0, failed: 0 });
    const run = listScheduledTaskRunViews(task.id)[0]!;
    expect(run.status).toBe('pending');
    expect(run.sessionId).toBeTruthy();
    expect(listMessagesBySession(run.sessionId!).map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(listJobsBySession(run.sessionId!)).toHaveLength(1);
    expect(getScheduledTask(task.id)).toEqual(expect.objectContaining({ status: 'completed', nextRunAt: null }));
    expect(dispatchDueScheduledTasks(runAt)).toEqual({ dispatched: 0, skipped: 0, failed: 0 });
  });

  it('原对话运行追加快照之前的最新历史', () => {
    const session = createSession({ title: '原对话', modelId });
    createMessage({ sessionId: session.id, role: 'user', content: '历史', status: 'sent' });
    const task = createScheduledTask({ ...base, targetType: 'existing_session', targetSessionId: session.id });
    dispatchDueScheduledTasks(task.nextRunAt!);
    const run = listScheduledTaskRunViews(task.id)[0]!;
    expect(run.sessionId).toBe(session.id);
    expect(listMessagesBySession(session.id)).toHaveLength(3);
    expect(listJobsBySession(session.id)[0]?.payload.history).toHaveLength(1);
  });

  it('重复扫描与重叠 occurrence 不产生重复 Job', () => {
    const task = createScheduledTask(base);
    const firstAt = task.nextRunAt!;
    expect(dispatchDueScheduledTasks(firstAt).dispatched).toBe(1);
    expect(dispatchDueScheduledTasks(firstAt).dispatched).toBe(0);
    const nextAt = getScheduledTask(task.id)!.nextRunAt!;
    expect(dispatchDueScheduledTasks(nextAt)).toEqual({ dispatched: 0, skipped: 1, failed: 0 });
    const runs = listScheduledTaskRunViews(task.id);
    expect(runs).toHaveLength(2);
    expect(runs.find((run) => run.status === 'skipped')?.skippedReason).toBe('overlap');
    const dispatched = runs.find((run) => run.dispatchStatus === 'dispatched')!;
    expect(listJobsBySession(dispatched.sessionId!)).toHaveLength(1);
  });

  it('停机后只补跑最近一次遗漏 occurrence', () => {
    const task = createScheduledTask(base);
    const now = Date.UTC(2026, 10, 3, 2, 0, 0);
    expect(dispatchDueScheduledTasks(now).dispatched).toBe(1);
    const runs = listScheduledTaskRunViews(task.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual(expect.objectContaining({ scheduledFor: Date.UTC(2026, 10, 3, 1), triggerType: 'catch_up' }));
    expect(getScheduledTask(task.id)!.nextRunAt).toBe(Date.UTC(2026, 10, 4, 1));
  });

  it('目标会话失效时记录失败并暂停任务', () => {
    const session = createSession({ title: '将删除', modelId });
    const task = createScheduledTask({ ...base, targetType: 'existing_session', targetSessionId: session.id });
    const at = task.nextRunAt!;
    expect(getSession(session.id)).toBeTruthy();
    const { deleteSession } = awaitImportSession();
    deleteSession(session.id);
    expect(dispatchDueScheduledTasks(at)).toEqual({ dispatched: 0, skipped: 0, failed: 1 });
    expect(getScheduledTask(task.id)?.status).toBe('paused');
    expect(listScheduledTaskRunViews(task.id)[0]).toEqual(expect.objectContaining({ status: 'dispatch_failed', dispatchError: 'target_session_not_found' }));
  });

  it('立即运行不改变计划时间且拒绝重叠', () => {
    const task = createScheduledTask(base);
    const next = task.nextRunAt;
    const run = runScheduledTaskNow(task.id);
    expect(run.triggerType).toBe('manual');
    expect(run.scheduledFor).toBeNull();
    expect(getScheduledTask(task.id)?.nextRunAt).toBe(next);
    expect(() => runScheduledTaskNow(task.id)).toThrow('scheduled_task_overlap');
  });
});

// 避免为单个删除场景改变上方导入形状。
import { deleteSession as importedDeleteSession } from '../../repo/session.js';
function awaitImportSession(): { deleteSession: typeof importedDeleteSession } {
  return { deleteSession: importedDeleteSession };
}
