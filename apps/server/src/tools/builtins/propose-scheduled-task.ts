import type { ScheduledTaskInput } from '@my-copilot/shared';
import type { ToolExecutor } from '../registry.js';
import { builtinTool, errorResult, jsonResult, optionalString, requiredString } from './helpers.js';
import { proposeScheduledTask } from '../../scheduler/drafts.js';
import { getSession } from '../../repo/session.js';

function normalize(args: Record<string, unknown>, sessionId: string): ScheduledTaskInput {
  const scheduleType = args.scheduleType;
  if (scheduleType !== 'once' && scheduleType !== 'cron') throw new Error('scheduleType must be once or cron');
  const runAt = args.runAt;
  if (runAt !== undefined && runAt !== null && typeof runAt !== 'number') throw new Error('runAt must be a number or null');
  const cronExpression = args.cronExpression;
  if (cronExpression !== undefined && cronExpression !== null && typeof cronExpression !== 'string') throw new Error('cronExpression must be a string or null');
  const targetType = args.targetType ?? 'existing_session';
  if (targetType !== 'new_session' && targetType !== 'existing_session') throw new Error('targetType must be new_session or existing_session');
  const targetSessionId = targetType === 'new_session' ? null : optionalString(args, 'targetSessionId') ?? sessionId;
  const session = getSession(sessionId);
  const modelId = optionalString(args, 'modelId') ?? session?.modelId;
  if (!modelId) throw new Error('modelId is required when the source session has no model');
  const skillArgs = args.enforcedSkillIds ?? [];
  if (!Array.isArray(skillArgs) || !skillArgs.every((id) => typeof id === 'string')) throw new Error('enforcedSkillIds must be a string array');
  return {
    name: requiredString(args, 'name', 4096), prompt: requiredString(args, 'prompt'), scheduleType,
    runAt: (runAt ?? null) as number | null, cronExpression: (cronExpression ?? null) as string | null,
    timezone: optionalString(args, 'timezone', 128) ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    targetType, targetSessionId, modelId, enforcedSkillIds: skillArgs,
  };
}

export const proposeScheduledTaskExecutor: ToolExecutor = {
  describe: () => builtinTool({
    id: 'propose-scheduled-task', name: 'propose_scheduled_task',
    description: 'Create an editable draft when the user asks to schedule agent work. This never creates the actual task; the user must review and confirm the card first.',
    fields: [
      { name: 'name', type: 'string', description: '任务名称', required: true },
      { name: 'prompt', type: 'string', description: '每次运行要执行的完整、持久化指令', required: true },
      { name: 'scheduleType', type: 'string', description: 'once 或 cron', required: true },
      { name: 'runAt', type: 'number', description: '单次任务的 UTC 毫秒时间戳；周期任务为 null', required: false },
      { name: 'cronExpression', type: 'string', description: '五字段 Cron；单次任务为 null', required: false },
      { name: 'timezone', type: 'string', description: 'IANA 时区，默认 Server 时区', required: false },
      { name: 'targetType', type: 'string', description: 'new_session 或 existing_session，默认依附当前对话', required: false },
      { name: 'targetSessionId', type: 'string', description: '依附已有对话的 ID，默认当前对话', required: false },
      { name: 'modelId', type: 'string', description: '执行模型 ID，默认当前对话模型', required: false },
      { name: 'enforcedSkillIds', type: 'array', description: '可选的显式 Skill ID 数组', required: false },
    ],
  }),
  async execute(args, context) {
    if (context.signal?.aborted) return errorResult('Tool execution was cancelled');
    try {
      const draft = proposeScheduledTask(normalize(args, context.sessionId), context);
      await context.onScheduledTaskDraft?.(draft);
      return jsonResult({ draftId: draft.id, message: '草稿已生成，请向用户展示确认卡片；只有用户确认后才会创建任务。' });
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  },
};

