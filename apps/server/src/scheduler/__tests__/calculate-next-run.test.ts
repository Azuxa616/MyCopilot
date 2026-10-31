import { describe, expect, it } from 'vitest';
import type { ScheduledTaskInput } from '@my-copilot/shared';
import { getNextRunAt } from '../calculate-next-run.js';
function input(patch: Partial<ScheduledTaskInput> = {}): ScheduledTaskInput {
  return { name: '日报', prompt: '生成日报', scheduleType: 'cron', runAt: null, cronExpression: '0 9 * * *', timezone: 'Asia/Hong_Kong', targetType: 'new_session', targetSessionId: null, modelId: 'model-1', enforcedSkillIds: [], ...patch };
}
describe('getNextRunAt', () => {
  it('单次任务只接受未来时间', () => { const now = Date.UTC(2026, 9, 30); expect(getNextRunAt(input({ scheduleType: 'once', runAt: now + 1000, cronExpression: null }), now)).toBe(now + 1000); expect(getNextRunAt(input({ scheduleType: 'once', runAt: now, cronExpression: null }), now)).toBeNull(); });
  it('按任务时区计算下一个周一', () => { expect(getNextRunAt(input({ cronExpression: '0 9 * * 1' }), Date.UTC(2026, 9, 30))).toBe(Date.UTC(2026, 10, 2, 1)); });
  it('春季 DST 切换后仍保持当地 09:00', () => { expect(getNextRunAt(input({ timezone: 'America/New_York' }), Date.UTC(2026, 2, 7, 15))).toBe(Date.UTC(2026, 2, 8, 13)); });
  it('秋季 DST 切换后仍保持当地 09:00', () => { expect(getNextRunAt(input({ timezone: 'America/New_York' }), Date.UTC(2026, 9, 31, 14))).toBe(Date.UTC(2026, 10, 1, 14)); });
  it('拒绝无效 Cron 与时区', () => { expect(() => getNextRunAt(input({ cronExpression: 'not-cron' }), 0)).toThrow('invalid_cron_expression'); expect(() => getNextRunAt(input({ timezone: 'Mars/Base' }), 0)).toThrow('invalid_timezone'); });
});
