/**
 * live：真实算术任务（trials=3，pass^k 一致性统计）。
 * 围绕 demo 白名单工具的真实任务；replayable=false（真实 LLM 不可确定性重放）。
 */
import type { EvalScenario } from '@my-copilot/shared';

export const liveCalculatorArithmetic: EvalScenario = {
  id: 'live-calculator-arithmetic',
  name: '真实算术任务',
  description: '用 calculator 计算 17*23 并汇报结果（期望 391）。',
  category: 'task',
  mode: 'live',
  tools: ['calculator'],
  userMessage: '请用计算器工具计算 17*23，并直接告诉我结果。',
  trials: 3,
  replayable: false,
  assertions: [
    { kind: 'tool_sequence', expected: ['calculator'] },
    { kind: 'final_contains', expected: '391' },
  ],
};
