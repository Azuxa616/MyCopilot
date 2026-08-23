import type { Message, MessageRole, MessageStatus, AttachmentMeta, ToolCall } from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId, now } from './base.js';

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  attachments: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  status: string;
  error: string | null;
  created_at: number;
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as MessageRole,
    content: row.content,
    attachments: JSON.parse(row.attachments) as AttachmentMeta[],
    toolCalls: row.tool_calls ? (JSON.parse(row.tool_calls) as ToolCall[]) : undefined,
    toolCallId: row.tool_call_id ?? undefined,
    status: row.status as MessageStatus,
    error: row.error ?? undefined,
    createdAt: row.created_at,
  };
}

export function listMessagesBySession(sessionId: string): Message[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as MessageRow[];
  return rows.map(rowToMessage);
}

export function getMessage(id: string): Message | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined;
  return row ? rowToMessage(row) : undefined;
}

export function createMessage(params: {
  sessionId: string;
  role: MessageRole;
  content: string;
  attachments?: AttachmentMeta[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  status: MessageStatus;
}): Message {
  const db = getDb();
  const id = generateId();
  const ts = now();
  const attachments = params.attachments ?? [];
  const attachmentsJson = JSON.stringify(attachments);
  const toolCallsJson = params.toolCalls ? JSON.stringify(params.toolCalls) : null;

  db.prepare(
    `INSERT INTO messages (id, session_id, role, content, attachments, tool_calls, tool_call_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.sessionId,
    params.role,
    params.content,
    attachmentsJson,
    toolCallsJson,
    params.toolCallId ?? null,
    params.status,
    ts,
  );

  return {
    id,
    sessionId: params.sessionId,
    role: params.role,
    content: params.content,
    attachments,
    ...(params.toolCalls ? { toolCalls: params.toolCalls } : {}),
    ...(params.toolCallId ? { toolCallId: params.toolCallId } : {}),
    status: params.status,
    createdAt: ts,
  };
}

export function updateMessage(
  id: string,
  params: {
    content?: string;
    status?: MessageStatus;
    error?: string | null;
    toolCalls?: ToolCall[];
  },
): Message | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined;
  if (!existing) return undefined;

  const content = params.content ?? existing.content;
  const status = params.status ?? existing.status;
  const error = params.error !== undefined ? params.error : existing.error;
  const toolCalls =
    params.toolCalls !== undefined ? JSON.stringify(params.toolCalls) : existing.tool_calls;

  db.prepare(
    'UPDATE messages SET content = ?, status = ?, error = ?, tool_calls = ? WHERE id = ?',
  ).run(content, status, error, toolCalls, id);

  return {
    id,
    sessionId: existing.session_id,
    role: existing.role as MessageRole,
    content,
    attachments: JSON.parse(existing.attachments),
    toolCalls: toolCalls ? (JSON.parse(toolCalls) as ToolCall[]) : undefined,
    toolCallId: existing.tool_call_id ?? undefined,
    status: status as MessageStatus,
    error: error ?? undefined,
    createdAt: existing.created_at,
  };
}

export function updateMessageContent(id: string, content: string): void {
  const db = getDb();
  db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id);
}

export function deleteMessage(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  return result.changes > 0;
}
