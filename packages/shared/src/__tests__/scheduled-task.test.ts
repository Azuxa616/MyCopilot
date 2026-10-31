import { describe, expect, it } from 'vitest';
import { ScheduledTaskDraftStatus, ScheduledTaskStatus } from '../scheduled-task.js';
import type {
  ScheduledTaskDraft,
  ScheduledTaskInput,
  ScheduledTaskRunView,
} from '../scheduled-task.js';

const onceInput: ScheduledTaskInput = {
  name: '一次提醒',
  prompt: '提醒我查看构建结果',
  scheduleType: 'once',
  runAt: 1_793_280_000_000,
  cronExpression: null,
  timezone: 'Asia/Hong_Kong',
  targetType: 'new_session',
  targetSessionId: null,
  modelId: 'model-1',
  enforcedSkillIds: [],
};

describe('scheduled task types', () => {
  it('支持单次与 Cron 调度', () => {
    const cronInput: ScheduledTaskInput = {
      ...onceInput,
      scheduleType: 'cron',
      runAt: null,
      cronExpression: '0 9 * * 1',
    };
    expect(onceInput.scheduleType).toBe('once');
    expect(cronInput.cronExpression).toBe('0 9 * * 1');
  });

  it('支持新会话与已有会话目标', () => {
    const existing: ScheduledTaskInput = {
      ...onceInput,
      targetType: 'existing_session',
      targetSessionId: 'session-1',
    };
    expect(onceInput.targetSessionId).toBeNull();
    expect(existing.targetSessionId).toBe('session-1');
  });

  it('运行展示状态包含 Job、跳过和分发失败状态', () => {
    const run: ScheduledTaskRunView = {
      id: 'run-1',
      taskId: 'task-1',
      scheduledFor: null,
      triggerType: 'manual',
      jobId: null,
      sessionId: null,
      userMessageId: null,
      assistantMessageId: null,
      dispatchStatus: 'skipped',
      skippedReason: 'overlap',
      dispatchError: null,
      readAt: null,
      createdAt: 1,
      status: 'skipped',
    };
    expect(run.status).toBe('skipped');
  });

  it('草稿具有待确认、已确认和已取消状态', () => {
    const draft: ScheduledTaskDraft = {
      id: 'draft-1',
      sourceSessionId: 'session-1',
      sourceJobId: null,
      proposedPayload: onceInput,
      status: 'pending',
      confirmedTaskId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(draft.status).toBe(ScheduledTaskDraftStatus.PENDING);
    expect(ScheduledTaskStatus.ACTIVE).toBe('active');
  });
});
