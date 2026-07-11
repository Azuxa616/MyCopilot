import type { Job, JobStatus, JobType, CreateJobParams } from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId, now } from './base.js';

interface JobRow {
  id: string;
  type: string;
  payload: string;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  leased_at: number | null;
  lease_owner: string | null;
  error: string | null;
  result: string | null;
  session_id: string | null;
  created_at: number;
  updated_at: number;
}

function parseJsonObject(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    type: row.type as JobType,
    payload: parseJsonObject(row.payload),
    status: row.status as JobStatus,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leasedAt: row.leased_at,
    leaseOwner: row.lease_owner,
    error: row.error,
    result: row.result ? parseJsonObject(row.result) : null,
    sessionId: row.session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createJob(params: CreateJobParams): Job {
  const db = getDb();
  const id = generateId();
  const ts = now();
  const priority = params.priority ?? 0;
  const maxAttempts = params.maxAttempts ?? 3;
  const sessionId = params.sessionId ?? null;
  const payloadJson = JSON.stringify(params.payload);

  db.prepare(
    `INSERT INTO jobs
       (id, type, payload, status, priority, attempts, max_attempts, leased_at, lease_owner, error, result, session_id, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, 0, ?, NULL, NULL, NULL, NULL, ?, ?, ?)`,
  ).run(id, params.type, payloadJson, priority, maxAttempts, sessionId, ts, ts);

  return {
    id,
    type: params.type,
    payload: params.payload,
    status: 'pending',
    priority,
    attempts: 0,
    maxAttempts,
    leasedAt: null,
    leaseOwner: null,
    error: null,
    result: null,
    sessionId,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function getJob(id: string): Job | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  return row ? rowToJob(row) : undefined;
}

export function listJobs(filter?: { status?: JobStatus; type?: JobType }): Job[] {
  const db = getDb();
  if (!filter || (!filter.status && !filter.type)) {
    const rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as JobRow[];
    return rows.map(rowToJob);
  }
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (filter.status) {
    clauses.push('status = ?');
    values.push(filter.status);
  }
  if (filter.type) {
    clauses.push('type = ?');
    values.push(filter.type);
  }
  const rows = db
    .prepare(`SELECT * FROM jobs WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`)
    .all(...values) as JobRow[];
  return rows.map(rowToJob);
}

export function listPendingJobs(limit?: number): Job[] {
  const db = getDb();
  const rows = (
    limit
      ? db
          .prepare(
            'SELECT * FROM jobs WHERE status = ? ORDER BY priority DESC, created_at ASC LIMIT ?',
          )
          .all('pending', limit)
      : db
          .prepare('SELECT * FROM jobs WHERE status = ? ORDER BY priority DESC, created_at ASC')
          .all('pending')
  ) as JobRow[];
  return rows.map(rowToJob);
}

export function listJobsBySession(sessionId: string): Job[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM jobs WHERE session_id = ? ORDER BY created_at DESC')
    .all(sessionId) as JobRow[];
  return rows.map(rowToJob);
}

/**
 * Atomically claim the highest-priority pending job for a worker.
 * Uses UPDATE ... WHERE id = (SELECT ... LIMIT 1) RETURNING * so the
 * pick-and-lease happens in a single statement — no race between workers.
 * Increments `attempts` on every successful claim.
 */
export function claimJob(workerId: string): Job | undefined {
  const db = getDb();
  const ts = now();
  const row = db
    .prepare(
      `UPDATE jobs
         SET status = 'running',
             leased_at = ?,
             lease_owner = ?,
             attempts = attempts + 1,
             updated_at = ?
       WHERE id = (
         SELECT id FROM jobs
         WHERE status = 'pending'
         ORDER BY priority DESC, created_at ASC
         LIMIT 1
       )
       RETURNING *`,
    )
    .get(ts, workerId, ts) as JobRow | undefined;
  return row ? rowToJob(row) : undefined;
}

export function completeJob(id: string, result: Record<string, unknown>): Job | undefined {
  const db = getDb();
  const ts = now();
  const resultJson = JSON.stringify(result);
  const row = db
    .prepare(
      `UPDATE jobs
         SET status = 'done',
             result = ?,
             error = NULL,
             leased_at = NULL,
             lease_owner = NULL,
             updated_at = ?
       WHERE id = ? AND status = 'running'
       RETURNING *`,
    )
    .get(resultJson, ts, id) as JobRow | undefined;
  return row ? rowToJob(row) : undefined;
}

/**
 * Mark a running job as failed. `attempts` is incremented at claim time,
 * so if the current attempt count is still below `maxAttempts` the job is
 * returned to `pending` for another try; otherwise it is terminal `failed`.
 */
export function failJob(id: string, error: string): Job | undefined {
  const existing = getJob(id);
  if (!existing) return undefined;

  const db = getDb();
  const ts = now();
  const newStatus: JobStatus = existing.attempts < existing.maxAttempts ? 'pending' : 'failed';
  const row = db
    .prepare(
      `UPDATE jobs
         SET status = ?,
             error = ?,
             leased_at = NULL,
             lease_owner = NULL,
             updated_at = ?
       WHERE id = ?
       RETURNING *`,
    )
    .get(newStatus, error, ts, id) as JobRow | undefined;
  return row ? rowToJob(row) : undefined;
}

export function cancelJob(id: string): Job | undefined {
  const db = getDb();
  const ts = now();
  const row = db
    .prepare(
      `UPDATE jobs
         SET status = 'cancelled',
             leased_at = NULL,
             lease_owner = NULL,
             updated_at = ?
       WHERE id = ? AND status NOT IN ('done', 'failed', 'cancelled')
       RETURNING *`,
    )
    .get(ts, id) as JobRow | undefined;
  return row ? rowToJob(row) : undefined;
}

/**
 * Reclaim jobs whose lease has expired: any `running` job whose
 * `leased_at` is older than `leaseTimeoutMs` is reset to `pending`
 * so a worker can pick it up again. Returns the number of jobs reclaimed.
 */
export function reclaimStaleJobs(leaseTimeoutMs: number): number {
  const db = getDb();
  const cutoff = now() - leaseTimeoutMs;
  const info = db
    .prepare(
      `UPDATE jobs
         SET status = 'pending',
             leased_at = NULL,
             lease_owner = NULL,
             updated_at = ?
       WHERE status = 'running'
         AND leased_at IS NOT NULL
         AND leased_at < ?`,
    )
    .run(now(), cutoff);
  return info.changes;
}

/**
 * Extend the lease on a running job that the caller still owns.
 * Bumps `leased_at` and `updated_at` to now so the job is not picked
 * up by `reclaimStaleJobs` while work is ongoing. Returns true when
 * the row was updated; false if the job no longer exists, is no longer
 * `running`, or has been leased to a different worker.
 */
export function renewJobLease(id: string, workerId: string): boolean {
  const db = getDb();
  const ts = now();
  const info = db
    .prepare(
      `UPDATE jobs
         SET leased_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running' AND lease_owner = ?`,
    )
    .run(ts, ts, id, workerId);
  return info.changes > 0;
}

/**
 * Touch `updated_at` and record a `progress` value inside the job's
 * `result` JSON blob. No-op if the job does not exist.
 */
export function updateJobProgress(id: string, progress: number): void {
  const existing = getJob(id);
  if (!existing) return;
  const db = getDb();
  const ts = now();
  const mergedResult = { ...(existing.result ?? {}), progress };
  db.prepare('UPDATE jobs SET result = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(mergedResult),
    ts,
    id,
  );
}
