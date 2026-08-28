/** live：跨工具组合任务（时间 + 计算）。 */
import type { EvalScenario } from '@my-copilot/shared';

export const liveMultiToolComposite: EvalScenario = {
  id: 'live-multi-tool-composite',
  name: '多工具组合任务',
  description: '先查询当前时间，再用 calculator 计算 365*24（一年小时数，期望 8760）。',
  category: 'task',
  mode: 'live',
  tools: ['current_datetime', 'calculator'],
  userMessage: '请先用时间工具查询今天的日期，再用计算器算出一年有多少个小时（365*24）。',
  trials: 3,
  replayable: false,
  assertions: [
    { kind: 'tool_sequence', expected: ['current_datetime', 'calculator'] },
    { kind: 'final_contains', expected: '8760' },
  ],
};
