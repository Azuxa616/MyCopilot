/**
 * Memory repository（Context v2，T6）。
 *
 * 跨 session 持久化的记忆层：每个 (sessionId, key) 一行，value 保存结构化
 * 文本。检索是关键词 `LIKE` 扫描（SQLite 默认对 ASCII 大小写不敏感），
 * 明确不引入 Vector DB / embeddings（RFC §4 Non-Goal，ADR-3）。
 *
 * 表结构见迁移 `0004_memories.sql`：
 *   id, session_id, key, value, created_at, updated_at（时间为 ISO 8601 字符串）
 */
import type { MemoryRecord } from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId } from './base.js';

interface MemoryRow {
  id: string;
  session_id: string;
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

function rowToMemory(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    key: row.key,
    value: row.value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateMemoryParams {
  sessionId: string;
  key: string;
  value: string;
}

/**
 * 写入一条记忆。若同 (sessionId, key) 已存在则按 upsert 语义更新
 * value 与 updatedAt 并返回既有行（不抛错）；createdAt 与 id 保持不变。
 */
export function createMemory(params: CreateMemoryParams): MemoryRecord {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO memories (id, session_id, key, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  ).run(generateId(), params.sessionId, params.key, params.value, now, now);

  const row = db
    .prepare('SELECT * FROM memories WHERE session_id = ? AND key = ?')
    .get(params.sessionId, params.key) as MemoryRow;
  return rowToMemory(row);
}

/** 按 (sessionId, key) 读取一条记忆，不存在时返回 `undefined`。 */
export function getMemory(sessionId: string, key: string): MemoryRecord | undefined {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM memories WHERE session_id = ? AND key = ?')
    .get(sessionId, key) as MemoryRow | undefined;
  return row ? rowToMemory(row) : undefined;
}

/** 列出某 session 的全部记忆，按 key 升序。 */
export function listMemories(sessionId: string): MemoryRecord[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM memories WHERE session_id = ? ORDER BY key ASC')
    .all(sessionId) as MemoryRow[];
  return rows.map(rowToMemory);
}

/** 删除一条记忆；返回是否确实删除了行。 */
export function deleteMemory(sessionId: string, key: string): boolean {
  const db = getDb();
  const result = db
    .prepare('DELETE FROM memories WHERE session_id = ? AND key = ?')
    .run(sessionId, key);
  return result.changes > 0;
}

/**
 * 在某 session 内按关键词检索记忆：key 或 value 命中 `%query%` 均返回
 * （SQLite `LIKE` 默认对 ASCII 大小写不敏感，不做 ICU）。结果按 key 升序。
 */
export function searchMemories(sessionId: string, query: string): MemoryRecord[] {
  const db = getDb();
  const pattern = `%${query}%`;
  const rows = db
    .prepare(
      `SELECT * FROM memories
       WHERE session_id = ?
         AND (key LIKE ? OR value LIKE ?)
       ORDER BY key ASC`,
    )
    .all(sessionId, pattern, pattern) as MemoryRow[];
  return rows.map(rowToMemory);
}
