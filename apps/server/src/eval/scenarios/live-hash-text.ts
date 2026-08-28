/** live：文本哈希计算。 */
import type { EvalScenario } from '@my-copilot/shared';

export const liveHashText: EvalScenario = {
  id: 'live-hash-text',
  name: '文本哈希计算',
  description: '用 hash_text 计算 "MyCopilot" 的 sha256 哈希并输出（哈希值不可预测，仅断言工具调用）。',
  category: 'task',
  mode: 'live',
  tools: ['hash_text'],
  userMessage: '请用哈希工具计算字符串 "MyCopilot" 的 SHA-256 哈希值，并告诉我结果。',
  trials: 3,
  replayable: false,
  assertions: [{ kind: 'tool_sequence', expected: ['hash_text'] }],
};
