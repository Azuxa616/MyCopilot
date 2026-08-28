/** live：base64 编解码往返验证。 */
import type { EvalScenario } from '@my-copilot/shared';

export const liveBase64Roundtrip: EvalScenario = {
  id: 'live-base64-roundtrip',
  name: 'base64 编解码往返',
  description: '先 base64_encode 再 base64_decode 同一段中文文本，验证还原一致（期望最终含原文片段「你好」）。',
  category: 'task',
  mode: 'live',
  tools: ['base64_encode', 'base64_decode'],
  userMessage: '请把 "你好，世界" 先 base64 编码再解码，验证还原结果与原文一致并展示。',
  trials: 3,
  replayable: false,
  assertions: [
    { kind: 'tool_sequence', expected: ['base64_encode', 'base64_decode'] },
    { kind: 'final_contains', expected: '你好' },
  ],
};
