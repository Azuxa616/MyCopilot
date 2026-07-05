import type { Session, SessionSummary, CreateSessionParams } from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId, now } from './base.js';

interface SessionRow {
  id: string;
  title: string;
  model_id: string | null;
  created_at: number;
  updated_at: number;
  message_count?: number;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title,
    modelId: row.model_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSessionSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    title: row.title,
    modelId: row.model_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count ?? 0,
  };
}

export function listSessions(): SessionSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM messages WHERE session_id = s.id) as message_count
       FROM sessions s
       ORDER BY s.updated_at DESC`,
    )
    .all() as SessionRow[];
  return rows.map(rowToSessionSummary);
}

export function getSession(id: string): Session | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  return row ? rowToSession(row) : undefined;
}

export function createSession(params: CreateSessionParams): Session {
  const db = getDb();
  const id = generateId();
  const ts = now();
  const title = params.title ?? '新对话';
  const modelId = params.modelId ?? null;

  db.prepare(
    `INSERT INTO sessions (id, title, model_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, title, modelId, ts, ts);

  return {
    id,
    title,
    modelId,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function updateSession(
  id: string,
  params: { title?: string; modelId?: string | null },
): Session | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  if (!existing) return undefined;

  const title = params.title ?? existing.title;
  const modelId = params.modelId !== undefined ? params.modelId : existing.model_id;
  const ts = now();

  db.prepare('UPDATE sessions SET title = ?, model_id = ?, updated_at = ? WHERE id = ?').run(
    title,
    modelId,
    ts,
    id,
  );

  return {
    id,
    title,
    modelId,
    createdAt: existing.created_at,
    updatedAt: ts,
  };
}

export function deleteSession(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  return result.changes > 0;
}
