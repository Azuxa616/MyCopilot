/** live：真实模型的错误恢复（除零 → 纠正重算）。 */
import type { EvalScenario } from '@my-copilot/shared';

export const liveCalculatorRecovery: EvalScenario = {
  id: 'live-calculator-recovery',
  name: '真实模型错误恢复',
  description: '先让 calculator 计算 10/0（预期 isError），模型应改算 10/2=5 并汇报（恢复能力）。',
  category: 'recovery',
  mode: 'live',
  tools: ['calculator'],
  userMessage: '请先用计算器计算 10/0，如果失败就改算 10/2，最后告诉我能算出的结果。',
  trials: 3,
  replayable: false,
  assertions: [
    { kind: 'tool_sequence', expected: ['calculator', 'calculator'] },
    { kind: 'final_contains', expected: '5' },
  ],
};
