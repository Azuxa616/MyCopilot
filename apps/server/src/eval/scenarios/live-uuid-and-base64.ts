/** live：UUID 生成 + base64 编码的两步组合任务。 */
import type { EvalScenario } from '@my-copilot/shared';

export const liveUuidAndBase64: EvalScenario = {
  id: 'live-uuid-and-base64',
  name: 'UUID 生成与编码',
  description: '生成一个 UUID，再用 base64_encode 编码它并输出编码结果（宽松顺序匹配两个工具）。',
  category: 'task',
  mode: 'live',
  tools: ['generate_uuid', 'base64_encode'],
  userMessage: '请生成一个 UUID，然后对它进行 base64 编码，给我最终编码字符串。',
  trials: 3,
  replayable: false,
  assertions: [
    { kind: 'tool_sequence', expected: ['generate_uuid', 'base64_encode'] },
  ],
};
