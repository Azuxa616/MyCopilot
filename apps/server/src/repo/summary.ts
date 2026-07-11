/**
 * Message summary repository (T25).
 *
 * Persists LLM-generated conversation summaries so that long-running sessions
 * can compact their history instead of paying the full token cost on every
 * turn. One row per summary; the latest summary for a session is the one used
 * by the agent loop to decide what prefix of history has already been
 * "rolled up".
 *
 * Table schema lives in migration `0002_phase2_jobs_and_summaries.sql`:
 *   id, session_id, summary, summarized_up_to_message_id, token_count, created_at
 */
import { getDb } from '../db/index.js';
import { generateId, now } from './base.js';

/** A rolled-up summary of conversation history up to a given message. */
export interface MessageSummary {
  id: string;
  sessionId: string;
  summary: string;
  /** ID of the last message included in this summary (exclusive boundary). */
  summarizedUpToMessageId: string;
  /** Estimated token count of the summarized history at creation time. */
  tokenCount: number;
  createdAt: number;
}

interface SummaryRow {
  id: string;
  session_id: string;
  summary: string;
  summarized_up_to_message_id: string;
  token_count: number;
  created_at: number;
}

function rowToSummary(row: SummaryRow): MessageSummary {
  return {
    id: row.id,
    sessionId: row.session_id,
    summary: row.summary,
    summarizedUpToMessageId: row.summarized_up_to_message_id,
    tokenCount: row.token_count,
    createdAt: row.created_at,
  };
}

export interface CreateSummaryParams {
  sessionId: string;
  summary: string;
  summarizedUpToMessageId: string;
  tokenCount: number;
}

/**
 * Insert a new summary row.
 *
 * `summarizedUpToMessageId` should be the ID of the last message consumed by
 * the summarizer — the agent loop uses it to find the start of the
 * not-yet-summarized tail on the next iteration.
 */
export function createSummary(params: CreateSummaryParams): MessageSummary {
  const db = getDb();
  const id = generateId();
  const ts = now();

  db.prepare(
    `INSERT INTO message_summaries
       (id, session_id, summary, summarized_up_to_message_id, token_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.sessionId,
    params.summary,
    params.summarizedUpToMessageId,
    params.tokenCount,
    ts,
  );

  return {
    id,
    sessionId: params.sessionId,
    summary: params.summary,
    summarizedUpToMessageId: params.summarizedUpToMessageId,
    tokenCount: params.tokenCount,
    createdAt: ts,
  };
}

/**
 * Return the most recently created summary for a session, or `undefined` when
 * none exists. "Latest" is defined by `created_at DESC` so re-summaries
 * (after the tail grows again) supersede older rows.
 */
export function getLatestSummary(sessionId: string): MessageSummary | undefined {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM message_summaries
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(sessionId) as SummaryRow | undefined;
  return row ? rowToSummary(row) : undefined;
}

/**
 * List every summary for a session, newest first. Useful for inspection and
 * future "summary of summaries" cascades.
 */
export function listSummariesBySession(sessionId: string): MessageSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM message_summaries
       WHERE session_id = ?
       ORDER BY created_at DESC`,
    )
    .all(sessionId) as SummaryRow[];
  return rows.map(rowToSummary);
}
