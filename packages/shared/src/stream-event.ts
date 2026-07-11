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
  | { type: 'finish'; reason: 'stop' | 'tool_calls' | 'length' };
