import type {
  EvalAssertionResult,
  EvalFaultType,
  EvalMode,
  EvalRunResult,
} from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId } from './base.js';

/**
 * eval_runs 数据访问层（评估结果记录与聚合）。
 *
 * ⚠️ DB 隔离约定（必须遵守）：
 * eval CLI 在自己的独立子进程中先 `initDatabase(<独立临时目录>)` 再写入本表，
 * 从而获得与用户库隔离的 SQLite 文件——`initDatabase` 支持关旧开新（db/index.ts）。
 * 该隔离仅限 eval CLI 子进程；server 主进程绝不调用 initDatabase 切换 DB。
 */

interface EvalRunRow {
  id: string;
  scenario_id: string;
  mode: string;
  status: string;
  trial: number;
  metrics: string;
  fault_type: string | null;
  run_trace_id: string | null;
  assertion_results: string;
  started_at: string;
  ended_at: string | null;
}

export type EvalRunRecord = EvalRunResult & {
  id: string;
  trial: number;
  startedAt: string;
  endedAt: string | null;
};

export interface CreateEvalRunParams {
  scenarioId: string;
  mode: EvalMode;
  status: 'pass' | 'fail';
  /** live 场景第几次 trial；缺省 1。 */
  trial?: number;
  metrics: Record<string, number>;
  faultType?: EvalFaultType | null;
  runTraceId?: string | null;
  assertionResults: EvalAssertionResult[];
  startedAt?: string;
  endedAt?: string | null;
}

export interface EvalScenarioAggregate {
  scenarioId: string;
  mode: EvalMode;
  total: number;
  passed: number;
  passRate: number;
  /** metrics.steps_used 的均值；无任何带该指标的行时为 0。 */
  avgSteps: number;
}

function rowToRecord(row: EvalRunRow): EvalRunRecord {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    mode: row.mode as EvalMode,
    status: row.status as 'pass' | 'fail',
    trial: row.trial,
    metrics: JSON.parse(row.metrics) as Record<string, number>,
    faultType: (row.fault_type as EvalFaultType | null) ?? null,
    runTraceId: row.run_trace_id,
    assertionResults: JSON.parse(row.assertion_results) as EvalAssertionResult[],
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

/** 插入一条评估结果记录。id 为 randomUUID。 */
export function createEvalRun(params: CreateEvalRunParams): EvalRunRecord {
  const id = generateId();
  const trial = params.trial ?? 1;
  const startedAt = params.startedAt ?? new Date().toISOString();
  const record: EvalRunRecord = {
    id,
    scenarioId: params.scenarioId,
    mode: params.mode,
    status: params.status,
    trial,
    metrics: params.metrics,
    faultType: params.faultType ?? null,
    runTraceId: params.runTraceId ?? null,
    assertionResults: params.assertionResults,
    startedAt,
    endedAt: params.endedAt ?? null,
  };

  getDb()
    .prepare(
      `INSERT INTO eval_runs
         (id, scenario_id, mode, status, trial, metrics, fault_type, run_trace_id,
          assertion_results, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      params.scenarioId,
      params.mode,
      params.status,
      trial,
      JSON.stringify(params.metrics),
      params.faultType ?? null,
      params.runTraceId ?? null,
      JSON.stringify(params.assertionResults),
      startedAt,
      params.endedAt ?? null,
    );

  return record;
}

/** 清除某场景在某模式下的全部结果行，返回删除行数（eval CLI 清旧插新的替换语义）。 */
export function deleteEvalRuns(scenarioId: string, mode: EvalMode): number {
  const info = getDb()
    .prepare('DELETE FROM eval_runs WHERE scenario_id = ? AND mode = ?')
    .run(scenarioId, mode);
  return info.changes;
}

/** 列出评估结果（started_at 倒序）；scenarioId 省略时返回全部。 */
export function listEvalRuns(scenarioId?: string): EvalRunRecord[] {
  const db = getDb();
  const rows = (
    scenarioId === undefined
      ? db.prepare('SELECT * FROM eval_runs ORDER BY started_at DESC').all()
      : db
          .prepare('SELECT * FROM eval_runs WHERE scenario_id = ? ORDER BY started_at DESC')
          .all(scenarioId)
  ) as EvalRunRow[];
  return rows.map(rowToRecord);
}

/** 按 (scenario_id, mode) 聚合：pass 率与平均步数（metrics.steps_used 均值）。 */
export function aggregateByScenario(): EvalScenarioAggregate[] {
  const rows = getDb()
    .prepare(
      `SELECT
         scenario_id,
         mode,
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'pass' THEN 1 ELSE 0 END) AS passed,
         AVG(CASE WHEN status = 'pass' THEN 1.0 ELSE 0.0 END) AS pass_rate,
         AVG(json_extract(metrics, '$.steps_used')) AS avg_steps
       FROM eval_runs
       GROUP BY scenario_id, mode
       ORDER BY scenario_id ASC, mode ASC`,
    )
    .all() as Array<{
    scenario_id: string;
    mode: string;
    total: number;
    passed: number;
    pass_rate: number | null;
    avg_steps: number | null;
  }>;

  return rows.map((row) => ({
    scenarioId: row.scenario_id,
    mode: row.mode as EvalMode,
    total: row.total,
    passed: row.passed,
    passRate: row.pass_rate ?? 0,
    avgSteps: row.avg_steps ?? 0,
  }));
}
