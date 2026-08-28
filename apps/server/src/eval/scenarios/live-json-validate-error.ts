/** live：非法 JSON 的校验报错任务（真实模型面对工具错误的解释能力）。 */
import type { EvalScenario } from '@my-copilot/shared';

export const liveJsonValidateError: EvalScenario = {
  id: 'live-json-validate-error',
  name: 'JSON 校验报错',
  description: '用 json_format 检查一段非法 JSON（缺右括号），模型应指出其不合法（工具返回 isError 的解释路径）。',
  category: 'recovery',
  mode: 'live',
  tools: ['json_format'],
  userMessage: '请检查这段 JSON 是否合法：{"broken": [1,2,}，如果不合法请说明问题。',
  trials: 3,
  replayable: false,
  assertions: [{ kind: 'tool_sequence', expected: ['json_format'] }],
};
