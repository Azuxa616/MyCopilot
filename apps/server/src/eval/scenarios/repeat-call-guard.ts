/**
 * 重复调用熔断：同参 calculator 连发三轮。
 *
 * 第 1 轮真实执行；第 2/3 轮被 LoopGuard 重复检测跳过，runner 合成
 * "already attempted" 的 isError 工具结果（runner.ts:609-647），循环继续，
 * 末轮以 finish('stop') 收尾（否则脚本耗尽抛错会把终态变成 error）。
 *
 * 断言固定无「或」：tool_exec 步骤序列包含全部三次调用（1 次真实执行 +
 * 2 次合成 skipped isError），终态 completed。评分侧「skipped isError」的
 * 判定依据是步骤的 isError 与合成结果内容，不是工具名差异。
 */
import type { EvalScenario } from '@my-copilot/shared';
import { finalRound, toolRound } from './events.js';

const dupCall = (id: string) =>
  toolRound({
    content: `第 ${id.slice(-1)} 次用相同参数计算 2+3。`,
    calls: [{ id, name: 'calculator', args: { expression: '2+3' } }],
  });

export const repeatCallGuard: EvalScenario = {
  id: 'repeat-call-guard',
  name: '重复调用熔断',
  description:
    '同参 calculator 连发三轮：第 2/3 轮被 LoopGuard 跳过并合成 isError 结果，末轮文本收尾。断言 steps 出现 skipped isError 的 tool_exec 且终态 completed。',
  category: 'loop',
  mode: 'deterministic',
  tools: ['calculator'],
  userMessage: '请计算 2+3。',
  replayable: true,
  script: [
    dupCall('call-dup-1'),
    dupCall('call-dup-2'),
    dupCall('call-dup-3'),
    finalRound('相同参数的调用已被跳过，计算结果仍是 5，停止重试。'),
  ],
  assertions: [
    { kind: 'status', expected: 'completed' },
    { kind: 'tool_sequence', expected: ['calculator', 'calculator', 'calculator'] },
  ],
};
