/** SSE event types for the streaming protocol. */
export type SSEEventType =
  | 'placeholder'
  | 'delta'
  | 'done'
  | 'error'
  | 'aborted'
  | 'tool_call_start'
  | 'tool_call_delta'
  | 'tool_call_done'
  | 'tool_result'
  | 'confirmation_required'
  | 'job_status';

/** Placeholder event — sent first so the client can create local message UI. */
export interface PlaceholderEvent {
  msgId: string;
}

/** A content delta chunk from the LLM. */
export interface DeltaEvent {
  content: string;
}

/** Stream completed successfully. `title` is set when a session title is generated. */
export interface DoneEvent {
  messageId: string;
  title?: string;
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

/** The model started emitting a tool call at the given index. */
export interface ToolCallStartEvent {
  messageId: string;
  index: number;
}

/** Incremental delta for an in-progress tool call. */
export interface ToolCallDeltaEvent {
  messageId: string;
  index: number;
  id?: string;
  name?: string;
  argumentsDelta?: string;
}

/** A tool call finished — full id/name/arguments are available. */
export interface ToolCallDoneEvent {
  messageId: string;
  index: number;
  id: string;
  name: string;
  arguments: string;
}

/** Result of executing a tool call. */
export interface ToolResultEvent {
  messageId: string;
  toolCallId: string;
  result: string;
  isError: boolean;
}

/** A tool call requires user confirmation before execution. */
export interface ConfirmationRequiredEvent {
  messageId: string;
  toolCallId: string;
  toolName: string;
  arguments: string;
  dangerLevel: string;
}

/** Background job status update. */
export interface JobStatusEvent {
  jobId: string;
  status: string;
  progress?: number;
  error?: string;
}

/** Union of all possible SSE event data types. */
export type SSEEventData =
  | PlaceholderEvent
  | DeltaEvent
  | DoneEvent
  | ErrorEvent
  | AbortedEvent
  | ToolCallStartEvent
  | ToolCallDeltaEvent
  | ToolCallDoneEvent
  | ToolResultEvent
  | ConfirmationRequiredEvent
  | JobStatusEvent;
