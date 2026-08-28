/**
 * 工具错误恢复：第一轮 calculator 传非法表达式 "abc"（真实执行返回
 * isError），第二轮改传 "2+3" 成功，第三轮收尾。
 *
 * 断言最终 completed + final_contains("5")；tool_sequence 含两次 calculator
 * 步骤，评分侧须校验其 isError 呈 true→false 的恢复轨迹。
 */
import type { EvalScenario } from '@my-copilot/shared';
import { finalRound, toolRound } from './events.js';

export const toolErrorRecovery: EvalScenario = {
  id: 'tool-error-recovery',
  name: '工具错误恢复',
  description:
    'calculator 先传非法表达式 "abc" 得 isError，再改传 "2+3" 成功；断言终态 completed、final_contains("5")，工具步骤 isError true→false。',
  category: 'recovery',
  mode: 'deterministic',
  tools: ['calculator'],
  userMessage: '请帮我计算 2+3（第一次可能传错参数，请纠正后重试）。',
  replayable: true,
  script: [
    toolRound({
      content: '第一次尝试计算。',
      calls: [{ id: 'call-err-1', name: 'calculator', args: { expression: 'abc' } }],
    }),
    toolRound({
      content: '表达式非法，改用合法输入重试。',
      calls: [{ id: 'call-err-2', name: 'calculator', args: { expression: '2+3' } }],
    }),
    finalRound('修正后的计算结果是 5。'),
  ],
  assertions: [
    { kind: 'status', expected: 'completed' },
    { kind: 'tool_sequence', expected: ['calculator', 'calculator'] },
    { kind: 'final_contains', expected: '5' },
  ],
};
