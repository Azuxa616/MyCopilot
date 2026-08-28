/** live：UUID v4 生成与原样输出。 */
import type { EvalScenario } from '@my-copilot/shared';

export const liveUuidV4Check: EvalScenario = {
  id: 'live-uuid-v4-check',
  name: 'UUID 生成输出',
  description: '用 generate_uuid 生成一个 UUID 并原样输出（UUID 含连字符，期望片段「-」）。',
  category: 'task',
  mode: 'live',
  tools: ['generate_uuid'],
  userMessage: '请生成一个 UUID，并把它的原文字符串输出给我。',
  trials: 3,
  replayable: false,
  assertions: [
    { kind: 'tool_sequence', expected: ['generate_uuid'] },
    { kind: 'final_contains', expected: '-' },
  ],
};
