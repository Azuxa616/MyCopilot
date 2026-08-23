/** Structured stream event from LLM adapter (replaces raw string yielding). */
export type StreamEvent =
  | { type: 'content'; text: string }
  | { type: 'tool_call_start'; index: number }
  | {
      type: 'tool_call_delta';
      index: number;
      id?: string;
      name?: string;
      argumentsDelta?: string;
    }
  | { type: 'tool_call_done'; index: number; id: string; name: string; arguments: string }
  | { type: 'finish'; reason: 'stop' | 'tool_calls' | 'length' }
  /** v2 新增（Context Management v2），向后兼容：Extended Thinking 的推理文本增量，与 content 分开推送。 */
  | { type: 'reasoning'; text: string };
