import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import { createSession } from '../session.js';
import { createRun } from '../runTrace.js';
import {
  createEvalRun,
  deleteEvalRuns,
  listEvalRuns,
  aggregateByScenario,
} from '../eval.js';

describe('EvalRepo', () => {
  let testDir: string;
  let sessionId: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-test-'));
    initDatabase(testDir);
    sessionId = createSession({}).id;
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch {
      // ignore
    }
    if (testDir) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('createEvalRun persists a record with JSON columns round-tripping', () => {
    const run = createRun({ sessionId, userMessageId: 'um-1' });
    const record = createEvalRun({
      scenarioId: 'multi-step-tool-chain',
      mode: 'deterministic',
      status: 'pass',
      metrics: { steps_used: 4, llm_calls: 2, duration_ms: 1200, tokens_estimated: 800 },
      faultType: null,
      runTraceId: run.id,
      assertionResults: [
        { kind: 'status', pass: true, detail: 'expected completed, got completed' },
        { kind: 'tool_sequence', pass: true, detail: 'calculator,json_format' },
      ],
      endedAt: '2026-08-28T00:00:05.000Z',
    });

    expect(record.id).toMatch(/[0-9a-f-]{36}/);
    expect(record.scenarioId).toBe('multi-step-tool-chain');
    expect(record.mode).toBe('deterministic');
    expect(record.status).toBe('pass');
    expect(record.trial).toBe(1);
    expect(record.metrics).toEqual({ steps_used: 4, llm_calls: 2, duration_ms: 1200, tokens_estimated: 800 });
    expect(record.faultType).toBeNull();
    expect(record.runTraceId).toBe(run.id);
    expect(record.assertionResults).toEqual([
      { kind: 'status', pass: true, detail: 'expected completed, got completed' },
      { kind: 'tool_sequence', pass: true, detail: 'calculator,json_format' },
    ]);
    expect(record.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(record.endedAt).toBe('2026-08-28T00:00:05.000Z');

    const fetched = listEvalRuns().find((r) => r.id === record.id);
    expect(fetched).toEqual(record);
  });

  it('createEvalRun honours explicit trial and failed fault attribution', () => {
    const record = createEvalRun({
      scenarioId: 'repeat-call-guard',
      mode: 'live',
      status: 'fail',
      trial: 3,
      metrics: { steps_used: 9 },
      faultType: 'repeat_blocked',
      assertionResults: [{ kind: 'status', pass: false, detail: 'expected completed, got incomplete' }],
    });

    expect(record.trial).toBe(3);
    expect(record.faultType).toBe('repeat_blocked');
    expect(record.runTraceId).toBeNull();
    expect(record.endedAt).toBeNull();
  });

  it('listEvalRuns filters by scenario and orders by startedAt DESC', () => {
    createEvalRun({
      scenarioId: 'sc-a',
      mode: 'deterministic',
      status: 'pass',
      metrics: {},
      assertionResults: [],
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    const newer = createEvalRun({
      scenarioId: 'sc-a',
      mode: 'deterministic',
      status: 'fail',
      metrics: {},
      faultType: 'other',
      assertionResults: [],
      startedAt: '2026-02-01T00:00:00.000Z',
    });
    createEvalRun({
      scenarioId: 'sc-b',
      mode: 'live',
      status: 'pass',
      metrics: {},
      assertionResults: [],
    });

    const all = listEvalRuns();
    expect(all).toHaveLength(3);

    const scoped = listEvalRuns('sc-a');
    expect(scoped).toHaveLength(2);
    expect(scoped.map((r) => r.startedAt)).toEqual([
      '2026-02-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
    expect(scoped[0].id).toBe(newer.id);

    expect(listEvalRuns('no-such-scenario')).toEqual([]);
  });

  it('deleteEvalRuns is scoped to scenario+mode only', () => {
    createEvalRun({ scenarioId: 'sc-a', mode: 'deterministic', status: 'pass', metrics: {}, assertionResults: [] });
    createEvalRun({ scenarioId: 'sc-a', mode: 'live', status: 'pass', metrics: {}, assertionResults: [] });
    createEvalRun({ scenarioId: 'sc-b', mode: 'deterministic', status: 'fail', metrics: {}, faultType: 'other', assertionResults: [] });

    const removed = deleteEvalRuns('sc-a', 'deterministic');

    expect(removed).toBe(1);
    const remaining = listEvalRuns();
    expect(remaining.map((r) => `${r.scenarioId}:${r.mode}`).sort()).toEqual([
      'sc-a:live',
      'sc-b:deterministic',
    ]);
  });

  it('replace semantics: deleteEvalRuns then re-insert leaves no stale rows', () => {
    // 清旧插新（CLI 每次运行前的替换语义）：旧行不得残留
    const stale = createEvalRun({
      scenarioId: 'sc-a',
      mode: 'deterministic',
      status: 'fail',
      metrics: { steps_used: 99 },
      faultType: 'goal_incomplete',
      assertionResults: [{ kind: 'status', pass: false, detail: 'stale' }],
    });

    deleteEvalRuns('sc-a', 'deterministic');

    const fresh = createEvalRun({
      scenarioId: 'sc-a',
      mode: 'deterministic',
      status: 'pass',
      metrics: { steps_used: 4 },
      assertionResults: [{ kind: 'status', pass: true, detail: 'fresh' }],
    });

    const rows = listEvalRuns('sc-a');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(fresh.id);
    expect(rows.map((r) => r.id)).not.toContain(stale.id);

    const dbRow = getDb()
      .prepare('SELECT COUNT(*) as n FROM eval_runs WHERE id = ?')
      .get(stale.id) as { n: number };
    expect(dbRow.n).toBe(0);
  });

  it('aggregateByScenario computes passRate and avgSteps per scenario+mode (3 pass + 1 fail → 0.75)', () => {
    for (const steps of [4, 5, 6]) {
      createEvalRun({
        scenarioId: 'sc-a',
        mode: 'deterministic',
        status: 'pass',
        metrics: { steps_used: steps },
        assertionResults: [],
      });
    }
    createEvalRun({
      scenarioId: 'sc-a',
      mode: 'deterministic',
      status: 'fail',
      metrics: { steps_used: 7 },
      faultType: 'used_wrong_tool',
      assertionResults: [],
    });
    createEvalRun({
      scenarioId: 'sc-b',
      mode: 'live',
      status: 'pass',
      metrics: { steps_used: 2 },
      assertionResults: [],
    });

    const aggregates = aggregateByScenario();
    expect(aggregates).toHaveLength(2);

    const scA = aggregates.find((a) => a.scenarioId === 'sc-a' && a.mode === 'deterministic');
    expect(scA?.total).toBe(4);
    expect(scA?.passed).toBe(3);
    expect(scA?.passRate).toBe(0.75);
    expect(scA?.avgSteps).toBe((4 + 5 + 6 + 7) / 4);

    const scB = aggregates.find((a) => a.scenarioId === 'sc-b' && a.mode === 'live');
    expect(scB?.total).toBe(1);
    expect(scB?.passed).toBe(1);
    expect(scB?.passRate).toBe(1);
    expect(scB?.avgSteps).toBe(2);
  });

  it('aggregateByScenario treats rows without steps_used metric as NULL steps in avgSteps', () => {
    createEvalRun({
      scenarioId: 'sc-a',
      mode: 'deterministic',
      status: 'pass',
      metrics: {},
      assertionResults: [],
    });
    createEvalRun({
      scenarioId: 'sc-a',
      mode: 'deterministic',
      status: 'pass',
      metrics: { steps_used: 6 },
      assertionResults: [],
    });

    const [aggregate] = aggregateByScenario();
    expect(aggregate.total).toBe(2);
    expect(aggregate.passRate).toBe(1);
    // AVG 忽略 NULL：仅对有 steps_used 的行求均值
    expect(aggregate.avgSteps).toBe(6);
  });

  it('aggregateByScenario returns empty array when no rows exist', () => {
    expect(aggregateByScenario()).toEqual([]);
  });
});
