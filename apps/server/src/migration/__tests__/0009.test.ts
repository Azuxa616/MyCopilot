import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';

describe('migration 0009 eval runs', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'migration-0009-'));
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
        "INSERT INTO runs (id, session_id, user_message_id, status, started_at) VALUES (?, ?, 'um1', 'completed', '2026-08-28T00:00:00.000Z')",
      )
      .run(id, sessionId);

  const insertEvalRun = (id: string, overrides: Partial<Record<string, unknown>> = {}) => {
    const columns: Record<string, unknown> = {
      id,
      scenario_id: 'multi-step-tool-chain',
      mode: 'deterministic',
      status: 'pass',
      trial: 1,
      metrics: '{"steps_used":4}',
      fault_type: null,
      run_trace_id: null,
      assertion_results: '[]',
      started_at: '2026-08-28T00:00:00.000Z',
      ended_at: null,
      ...overrides,
    };
    const keys = Object.keys(columns);
    getDb()
      .prepare(
        `INSERT INTO eval_runs (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      )
      .run(...keys.map((k) => columns[k]));
  };

  it('creates eval_runs table with scenario/mode index', () => {
    const objects = getDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE name IN ('eval_runs', 'idx_eval_runs_scenario_mode')",
      )
      .all() as Array<{ name: string }>;
    const names = objects.map((o) => o.name);
    expect(names).toContain('eval_runs');
    expect(names).toContain('idx_eval_runs_scenario_mode');

    const cols = getDb().prepare('PRAGMA table_info(eval_runs)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'scenario_id',
        'mode',
        'status',
        'trial',
        'metrics',
        'fault_type',
        'run_trace_id',
        'assertion_results',
        'started_at',
        'ended_at',
      ]),
    );
  });

  it('declares no UNIQUE constraint on eval_runs (sqlite_master + index_list)', () => {
    // 表 DDL 本身不含 UNIQUE（防重由 CLI 清旧插新的替换语义保证，非 schema 约束）
    const tableRow = getDb()
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'eval_runs'")
      .get() as { sql: string };
    expect(tableRow.sql).not.toMatch(/UNIQUE/i);

    // 声明显式索引（sql 非空）均不携带 UNIQUE 关键字
    const declaredIndexes = getDb()
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'eval_runs' AND sql IS NOT NULL")
      .all() as Array<{ name: string; sql: string }>;
    expect(declaredIndexes.length).toBeGreaterThan(0);
    for (const idx of declaredIndexes) {
      expect(idx.sql).not.toMatch(/UNIQUE/i);
    }

    // origin='u' 是 UNIQUE 约束的自动索引；'pk' 仅为 TEXT PRIMARY KEY 的隐式索引（id PK 是规格要求）
    const indexList = getDb().prepare('PRAGMA index_list(eval_runs)').all() as Array<{
      name: string;
      unique: number;
      origin: string;
    }>;
    const uniqueConstraints = indexList.filter((idx) => idx.origin === 'u' || (idx.unique === 1 && idx.origin !== 'pk'));
    expect(uniqueConstraints).toEqual([]);
  });

  it('mode CHECK only accepts deterministic and live', () => {
    insertEvalRun('er-1', { mode: 'deterministic' });
    insertEvalRun('er-2', { mode: 'live' });

    expect(() => insertEvalRun('er-bogus', { mode: 'replay' })).toThrow(/CHECK constraint failed/i);
  });

  it('status CHECK only accepts pass and fail', () => {
    insertEvalRun('er-pass', { status: 'pass' });
    insertEvalRun('er-fail', { status: 'fail' });

    expect(() => insertEvalRun('er-bogus', { status: 'error' })).toThrow(
      /CHECK constraint failed/i,
    );
  });

  it('sets run_trace_id to NULL when the referenced run is deleted', () => {
    insertSession('s1');
    insertRun('r1', 's1');
    insertEvalRun('er-1', { run_trace_id: 'r1' });

    getDb().prepare("DELETE FROM runs WHERE id = 'r1'").run();

    const row = getDb()
      .prepare('SELECT id, run_trace_id FROM eval_runs WHERE id = ?')
      .get('er-1') as { id: string; run_trace_id: string | null };
    // SET NULL：行保留，引用置空（与 CASCADE 不同——评估记录不随轨迹删除）
    expect(row).toBeDefined();
    expect(row.run_trace_id).toBeNull();
  });

  it('is idempotent: re-running initDatabase does not re-apply or fail', () => {
    insertEvalRun('er-1');

    expect(() => initDatabase(testDir)).not.toThrow();

    const rows = getDb()
      .prepare('SELECT COUNT(*) as n FROM sqlite_master WHERE type = $type AND name = $name')
      .get({ type: 'table', name: 'eval_runs' }) as { n: number };
    expect(rows.n).toBe(1);

    const data = getDb().prepare('SELECT COUNT(*) as n FROM eval_runs').get() as { n: number };
    expect(data.n).toBe(1);
  });
});
