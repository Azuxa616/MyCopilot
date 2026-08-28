/** live：JSON 排序格式化。 */
import type { EvalScenario } from '@my-copilot/shared';

export const liveJsonFormatSort: EvalScenario = {
  id: 'live-json-format-sort',
  name: 'JSON 排序格式化',
  description: '用 json_format 对给定 JSON 按键排序格式化并回显（期望保留值片段 MyCopilot）。',
  category: 'task',
  mode: 'live',
  tools: ['json_format'],
  userMessage: '请把这段 JSON 按键排序并格式化：{"name":"MyCopilot","age":3}，然后给我结果。',
  trials: 3,
  replayable: false,
  assertions: [
    { kind: 'tool_sequence', expected: ['json_format'] },
    { kind: 'final_contains', expected: 'MyCopilot' },
  ],
};
