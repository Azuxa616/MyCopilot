/**
 * 步数上限终止：maxSteps=2，脚本每轮都发（参数互不相同的）工具调用。
 *
 * runner 的 while (iterations < maxSteps) 在两次迭代后退出，脚本恰好消耗
 * 2 轮、无第 3 次 LLM 调用；终态映射 max_iterations → Run incomplete，
 * stopReason=max_steps。两次参数不同以避免重复熔断提前合成 skipped 结果。
 */
import type { EvalScenario } from '@my-copilot/shared';
import { toolRound } from './events.js';

export const maxStepsTermination: EvalScenario = {
  id: 'max-steps-termination',
  name: '步数上限终止',
  description: 'maxSteps=2 且脚本持续请求工具调用；断言 max_steps_hit + status=incomplete + stopReason=max_steps。',
  category: 'loop',
  mode: 'deterministic',
  tools: ['calculator'],
  userMessage: '请反复用 calculator 计算，直到被系统叫停。',
  maxSteps: 2,
  replayable: true,
  script: [
    toolRound({
      content: '第一轮计算。',
      calls: [{ id: 'call-max-1', name: 'calculator', args: { expression: '1+1' } }],
    }),
    toolRound({
      content: '第二轮计算。',
      calls: [{ id: 'call-max-2', name: 'calculator', args: { expression: '2+2' } }],
    }),
  ],
  assertions: [
    { kind: 'status', expected: 'incomplete' },
    { kind: 'max_steps_hit', expected: true },
  ],
};
