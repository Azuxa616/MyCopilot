import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';

describe('migration 0008 run traces', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'migration-0008-'));
    initDatabase(testDir);
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch {
      // ignore
    }
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  const insertSession = (id: string) =>
    getDb()
      .prepare("INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, 'T', 1, 1)")
      .run(id);

  const insertRun = (id: string, sessionId: string) =>
    getDb()
      .prepare(
        "INSERT INTO runs (id, session_id, user_message_id, status, started_at) VALUES (?, ?, 'um1', 'queued', '2026-08-28T00:00:00.000Z')",
      )
      .run(id, sessionId);

  const insertStep = (id: string, runId: string, seq: number) =>
    getDb()
      .prepare(
        "INSERT INTO run_steps (id, run_id, seq, type, duration_ms, created_at) VALUES (?, ?, ?, 'llm_call', 10, '2026-08-28T00:00:00.000Z')",
      )
      .run(id, runId, seq);

  it('creates runs and run_steps tables with session/run indexes', () => {
    const objects = getDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE name IN ('runs', 'run_steps', 'idx_runs_session_id', 'idx_run_steps_run_id')",
      )
      .all() as Array<{ name: string }>;
    const names = objects.map((o) => o.name);
    expect(names).toContain('runs');
    expect(names).toContain('run_steps');
    expect(names).toContain('idx_runs_session_id');
    expect(names).toContain('idx_run_steps_run_id');

    const runCols = getDb().prepare('PRAGMA table_info(runs)').all() as Array<{ name: string }>;
    expect(runCols.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'session_id',
        'user_message_id',
        'assistant_message_id',
        'agent_id',
        'job_id',
        'status',
        'stop_reason',
        'iterations',
        'budget_snapshot',
        'degraded',
        'total_tokens',
        'started_at',
        'ended_at',
        'error',
      ]),
    );

    const stepCols = getDb().prepare('PRAGMA table_info(run_steps)').all() as Array<{ name: string }>;
    expect(stepCols.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'run_id',
        'seq',
        'type',
        'tool_name',
        'args_preview',
        'result_preview',
        'is_error',
        'duration_ms',
        'created_at',
      ]),
    );
  });

  it('runs.status CHECK only accepts the 8 RunStatus values', () => {
    insertSession('s1');
    const statuses = [
      'queued',
      'in_progress',
      'requires_action',
      'completed',
      'cancelled',
      'failed',
      'incomplete',
      'expired',
    ];
    for (const [i, status] of statuses.entries()) {
      getDb()
        .prepare(
          "INSERT INTO runs (id, session_id, user_message_id, status, started_at) VALUES (?, 's1', 'um1', ?, '2026-08-28T00:00:00.000Z')",
        )
        .run(`r-${i}`, status);
    }

    expect(() =>
      getDb()
        .prepare(
          "INSERT INTO runs (id, session_id, user_message_id, status, started_at) VALUES ('r-bogus', 's1', 'um1', 'bogus', '2026-08-28T00:00:00.000Z')",
        )
        .run(),
    ).toThrow(/CHECK constraint failed/i);
  });

  it('run_steps.type CHECK only accepts llm_call and tool_exec', () => {
    insertSession('s1');
    insertRun('r1', 's1');

    expect(() =>
      getDb()
        .prepare(
          "INSERT INTO run_steps (id, run_id, seq, type, duration_ms, created_at) VALUES ('st-bogus', 'r1', 1, 'bogus', 10, '2026-08-28T00:00:00.000Z')",
        )
        .run(),
    ).toThrow(/CHECK constraint failed/i);
  });

  it('rejects duplicate (run_id, seq) with a UNIQUE constraint error', () => {
    insertSession('s1');
    insertRun('r1', 's1');
    insertStep('st1', 'r1', 1);

    expect(() => insertStep('st2', 'r1', 1)).toThrow(
      /UNIQUE constraint failed: run_steps\.run_id, run_steps\.seq/,
    );
  });

  it('cascades session deletion to runs and run_steps', () => {
    insertSession('s1');
    insertRun('r1', 's1');
    insertRun('r2', 's1');
    insertStep('st1', 'r1', 1);
    insertStep('st2', 'r2', 1);
    insertStep('st3', 'r2', 2);

    getDb().prepare("DELETE FROM sessions WHERE id = 's1'").run();

    const runs = getDb().prepare('SELECT COUNT(*) as n FROM runs').get() as { n: number };
    const steps = getDb().prepare('SELECT COUNT(*) as n FROM run_steps').get() as { n: number };
    expect(runs.n).toBe(0);
    expect(steps.n).toBe(0);
  });

  it('is idempotent: re-running initDatabase does not re-apply or fail', () => {
    expect(() => initDatabase(testDir)).not.toThrow();

    const rows = getDb()
      .prepare("SELECT COUNT(*) as n FROM sqlite_master WHERE type = 'table' AND name = 'runs'")
      .get() as { n: number };
    expect(rows.n).toBe(1);
  });
});
