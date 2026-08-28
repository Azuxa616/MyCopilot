/**
 * 用户中断（部分内容保留）：eval runner 在首个 tool_result 事件回调内
 * 同步触发 abort（onEvent 在 runner.ts:597 被 await，工具持久化后 :650
 * 复查 abortSignal），run 以 aborted 终止 → Run cancelled。
 *
 * 脚本只需 1 轮（工具调用轮）；中断发生在工具结果返回后，无后续 LLM 调用。
 */
import type { EvalScenario } from '@my-copilot/shared';
import { toolRound } from './events.js';

export const userAbortPartial: EvalScenario = {
  id: 'user-abort-partial',
  name: '用户中断（部分内容）',
  description: '首个工具结果返回后立即 abort；断言 status=cancelled，已产生的部分内容保留。',
  category: 'loop',
  mode: 'deterministic',
  tools: ['calculator'],
  userMessage: '请计算 40+2（我会在工具返回后立刻停止你）。',
  replayable: true,
  behavior: { abortAfterToolResults: 1 },
  script: [
    toolRound({
      content: '开始计算 40+2。',
      calls: [{ id: 'call-abort-1', name: 'calculator', args: { expression: '40+2' } }],
    }),
  ],
  assertions: [{ kind: 'status', expected: 'cancelled' }],
};
