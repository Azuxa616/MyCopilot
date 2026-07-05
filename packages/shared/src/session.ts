export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Message role constants for ergonomic comparisons (e.g. `role === MessageRole.USER`).
 * Mirrors the union type above.
 */
export const MessageRole = {
  USER: 'user' as const,
  ASSISTANT: 'assistant' as const,
  SYSTEM: 'system' as const,
} as const;

export type MessageStatus = 'sending' | 'sent' | 'failed' | 'aborted';

/**
 * Message status constants for ergonomic comparisons (e.g. `status === MessageStatus.SENDING`).
 * Mirrors the union type above.
 */
export const MessageStatus = {
  SENDING: 'sending' as const,
  SENT: 'sent' as const,
  FAILED: 'failed' as const,
  ABORTED: 'aborted' as const,
} as const;

export interface AttachmentMeta {
  /** Unique ID for local management (frontend React keys / removal). Optional — server may not always set it. */
  id?: string;
  name: string;
  type: string;
  size: number;
  /** Text excerpt extracted by server during attachment parsing. Optional for locally-created attachments. */
  textExcerpt?: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  attachments: AttachmentMeta[];
  status: MessageStatus;
  error?: string;
  createdAt: number;
}

export interface Session {
  id: string;
  title: string;
  modelId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type SessionSummary = Session & { messageCount: number };

export interface CreateSessionParams {
  title?: string;
  modelId?: string | null;
}

export interface SendMessageParams {
  content: string;
}
