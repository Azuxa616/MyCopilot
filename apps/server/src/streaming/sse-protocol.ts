/** SSE event types for the streaming protocol. */
export type SSEEventType = 'delta' | 'done' | 'error' | 'aborted';

/** A content delta chunk from the LLM. */
export interface DeltaEvent {
  content: string;
}

/** Stream completed successfully. */
export interface DoneEvent {
  messageId: string;
}

/** Stream failed with an error. */
export interface ErrorEvent {
  code: string;
  message: string;
}

/** Stream was aborted (client disconnect or /stop endpoint). */
export interface AbortedEvent {
  messageId: string;
  partialContent: string;
}

/** Union of all possible SSE event data types. */
export type SSEEventData = DeltaEvent | DoneEvent | ErrorEvent | AbortedEvent;
