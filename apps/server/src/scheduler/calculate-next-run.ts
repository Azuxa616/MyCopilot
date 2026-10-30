import { Cron } from 'croner';
import type { ScheduledTaskInput } from '@my-copilot/shared';

export function getNextRunAt(input: ScheduledTaskInput, after: number): number | null {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format(after);
  } catch {
    throw new Error('invalid_timezone');
  }

  if (input.scheduleType === 'once') {
    if (input.runAt === null) throw new Error('run_at_required');
    return input.runAt > after ? input.runAt : null;
  }
  if (!input.cronExpression) throw new Error('cron_expression_required');
  try {
    return new Cron(input.cronExpression, { timezone: input.timezone })
      .nextRun(new Date(after))?.getTime() ?? null;
  } catch {
    throw new Error('invalid_cron_expression');
  }
}

export function getLatestRunAt(input: ScheduledTaskInput, at: number): number | null {
  if (input.scheduleType === 'once') return input.runAt;
  if (!input.cronExpression) throw new Error('cron_expression_required');
  try {
    return new Cron(input.cronExpression, { timezone: input.timezone })
      .previousRuns(1, new Date(at + 1))[0]?.getTime() ?? null;
  } catch {
    throw new Error('invalid_cron_expression');
  }
}
