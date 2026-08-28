/** live：当前时间查询。 */
import type { EvalScenario } from '@my-copilot/shared';

export const liveCurrentDatetime: EvalScenario = {
  id: 'live-current-datetime',
  name: '当前时间查询',
  description: '用 current_datetime 查询当前日期时间并汇报（期望含 202x 年份片段）。',
  category: 'task',
  mode: 'live',
  tools: ['current_datetime'],
  userMessage: '现在是什么时间？请用时间工具查询后告诉我当前日期和时间。',
  trials: 3,
  replayable: false,
  assertions: [
    { kind: 'tool_sequence', expected: ['current_datetime'] },
    { kind: 'final_contains', expected: '202' },
  ],
};
