/**
 * 多步工具链：第一轮并行调用 calculator 与 json_format（真实执行），
 * 第二轮文本收尾。校验 runtime 的多工具并行调度与终态。
 */
import type { EvalScenario } from '@my-copilot/shared';
import { finalRound, toolRound } from './events.js';

export const multiStepToolChain: EvalScenario = {
  id: 'multi-step-tool-chain',
  name: '多步工具链',
  description: 'LLM 两轮：第一轮并行发 calculator("2+3") 与 json_format 调用，第二轮文本结束。',
  category: 'task',
  mode: 'deterministic',
  tools: ['calculator', 'json_format'],
  userMessage: '请计算 2+3，并把 {"result":5} 这段 JSON 按键排序后格式化给我。',
  replayable: true,
  script: [
    toolRound({
      content: '我先并行执行计算与 JSON 格式化。',
      calls: [
        { id: 'call-calc-1', name: 'calculator', args: { expression: '2+3' } },
        { id: 'call-json-1', name: 'json_format', args: { json: '{"result":5}', sortKeys: true } },
      ],
    }),
    finalRound('计算结果为 5，JSON 已按键排序格式化完成。'),
  ],
  assertions: [
    { kind: 'status', expected: 'completed' },
    { kind: 'tool_sequence', expected: ['calculator', 'json_format'] },
    { kind: 'final_contains', expected: '5' },
  ],
};
