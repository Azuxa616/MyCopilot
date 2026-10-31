import type { JobStatus } from './job.js';

export type ScheduledTaskScheduleType = 'once' | 'cron';
export type ScheduledTaskTargetType = 'new_session' | 'existing_session';
export type ScheduledTaskStatus = 'active' | 'paused' | 'completed';
export const ScheduledTaskStatus = {
  ACTIVE: 'active' as const,
  PAUSED: 'paused' as const,
  COMPLETED: 'completed' as const,
};
export type ScheduledTaskTriggerType = 'schedule' | 'catch_up' | 'manual';
export type ScheduledTaskDispatchStatus = 'dispatched' | 'skipped' | 'failed';
export type ScheduledTaskDraftStatus = 'pending' | 'confirmed' | 'cancelled';
export const ScheduledTaskDraftStatus = {
  PENDING: 'pending' as const,
  CONFIRMED: 'confirmed' as const,
  CANCELLED: 'cancelled' as const,
};

export interface ScheduledTaskInput {
  name: string;
  prompt: string;
  scheduleType: ScheduledTaskScheduleType;
  runAt: number | null;
  cronExpression: string | null;
  timezone: string;
  targetType: ScheduledTaskTargetType;
  targetSessionId: string | null;
  modelId: string;
  enforcedSkillIds: string[];
}

export interface ScheduledTask extends ScheduledTaskInput {
  id: string;
  status: ScheduledTaskStatus;
  nextRunAt: number | null;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledTaskListItem extends ScheduledTask {
  targetSessionTitle: string | null;
  lastRunStatus: JobStatus | 'skipped' | 'dispatch_failed' | null;
  lastRunAt: number | null;
  hasUnread: boolean;
}

export interface ScheduledTaskRun {
  id: string;
  taskId: string;
  scheduledFor: number | null;
  triggerType: ScheduledTaskTriggerType;
  jobId: string | null;
  sessionId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
  dispatchStatus: ScheduledTaskDispatchStatus;
  skippedReason: string | null;
  dispatchError: string | null;
  readAt: number | null;
  createdAt: number;
}

export interface ScheduledTaskRunView extends ScheduledTaskRun {
  status: JobStatus | 'skipped' | 'dispatch_failed';
}

export interface ScheduledTaskDraft {
  id: string;
  sourceSessionId: string;
  sourceJobId: string | null;
  proposedPayload: ScheduledTaskInput;
  status: ScheduledTaskDraftStatus;
  confirmedTaskId: string | null;
  createdAt: number;
  updatedAt: number;
}
