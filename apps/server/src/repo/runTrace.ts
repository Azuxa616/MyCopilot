import type {
  BudgetBreakdown,
  RunStatus,
  RunStepRecord,
  RunTraceRecord,
  RunTraceStepType,
  StopReason,
  TraceCollector,
} from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId } from './base.js';

/** preview 截断上限：超出部分丢弃并追加标记。 */
const PREVIEW_MAX_LENGTH = 500;
const PREVIEW_TRUNCATED_SUFFIX = '…[truncated]';

/** 非终态状态集合：服务重启时这些 Run 会被批量判为中断失败。 */
const NON_TERMINAL_STATUSES: readonly RunStatus[] = ['queued', 'in_progress', 'requires_action'];

interface RunRow {
  id: string;
  session_id: string;
  user_message_id: string;
  assistant_message_id: string | null;
  agent_id: string | null;
  job_id: string | null;
  status: string;
  stop_reason: string | null;
  iterations: number;
  budget_snapshot: string | null;
  degraded: number;
  total_tokens: number;
  started_at: string;
  ended_at: string | null;
  error: string | null;
  step_count?: number;
}

interface RunStepRow {
  id: string;
  run_id: string;
  seq: number;
  type: string;
  tool_name: string | null;
  args_preview: string | null;
  result_preview: string | null;
  is_error: number;
  duration_ms: number | null;
  created_at: string;
}

export interface CreateRunParams {
  sessionId: string;
  /** 触发本轮的真实用户消息 id（不是 assistant 占位 id）。 */
  userMessageId: string;
  assistantMessageId?: string | null;
  agentId?: string | null;
  jobId?: string | null;
  status?: RunStatus;
  startedAt?: string;
}

export interface UpdateRunParams {
  status?: RunStatus;
  stopReason?: StopReason | null;
  assistantMessageId?: string | null;
  iterations?: number;
  budgetSnapshot?: BudgetBreakdown | null;
  degraded?: boolean;
  totalTokens?: number;
  endedAt?: string | null;
  error?: string | null;
}

export interface AppendStepParams {
  runId: string;
  seq: number;
  type: RunTraceStepType;
  toolName?: string | null;
  argsPreview?: string | null;
  resultPreview?: string | null;
  isError?: boolean;
  durationMs: number;
}

/** 列表查询返回形状：Run 记录 + 该 Run 的步骤计数。 */
export type RunTraceWithStepCount = RunTraceRecord & { stepCount: number };

/** 将 preview 截断到 500 字符并追加截断标记。 */
export function truncatePreview(text: string): string {
  if (text.length <= PREVIEW_MAX_LENGTH) return text;
  return text.slice(0, PREVIEW_MAX_LENGTH) + PREVIEW_TRUNCATED_SUFFIX;
}

function parseBudgetSnapshot(json: string | null): BudgetBreakdown | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as BudgetBreakdown;
  } catch {
    return null;
  }
}

function rowToRun(row: RunRow): RunTraceRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    agentId: row.agent_id,
    jobId: row.job_id,
    status: row.status as RunStatus,
    stopReason: (row.stop_reason as StopReason | null) ?? null,
    iterations: row.iterations,
    budgetSnapshot: parseBudgetSnapshot(row.budget_snapshot),
    degraded: row.degraded === 1,
    totalTokens: row.total_tokens,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    error: row.error,
  };
}

function rowToStep(row: RunStepRow): RunStepRecord {
  return {
    id: row.id,
    runId: row.run_id,
    seq: row.seq,
    type: row.type as RunTraceStepType,
    toolName: row.tool_name,
    argsPreview: row.args_preview,
    resultPreview: row.result_preview,
    isError: row.is_error === 1,
    durationMs: row.duration_ms ?? 0,
    createdAt: row.created_at,
  };
}

/** 创建一条 Run 轨迹记录（初始 status 默认 'queued'）。id 为 randomUUID。 */
export function createRun(params: CreateRunParams): RunTraceRecord {
  const db = getDb();
  const id = generateId();
  const status: RunStatus = params.status ?? 'queued';
  const startedAt = params.startedAt ?? new Date().toISOString();

  db.prepare(
    `INSERT INTO runs
       (id, session_id, user_message_id, assistant_message_id, agent_id, job_id,
        status, stop_reason, iterations, budget_snapshot, degraded, total_tokens,
        started_at, ended_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, 0, 0, ?, NULL, NULL)`,
  ).run(
    id,
    params.sessionId,
    params.userMessageId,
    params.assistantMessageId ?? null,
    params.agentId ?? null,
    params.jobId ?? null,
    status,
    startedAt,
  );

  return {
    id,
    sessionId: params.sessionId,
    userMessageId: params.userMessageId,
    assistantMessageId: params.assistantMessageId ?? null,
    agentId: params.agentId ?? null,
    jobId: params.jobId ?? null,
    status,
    stopReason: null,
    iterations: 0,
    budgetSnapshot: null,
    degraded: false,
    totalTokens: 0,
    startedAt,
    endedAt: null,
    error: null,
  };
}

/** 合并更新 Run 的终态字段；仅覆盖显式传入的字段。 */
export function updateRun(runId: string, updates: UpdateRunParams): RunTraceRecord | undefined {
  const columns: Array<[string, string | number | null]> = [];
  if (updates.status !== undefined) columns.push(['status', updates.status]);
  if (updates.stopReason !== undefined) columns.push(['stop_reason', updates.stopReason]);
  if (updates.assistantMessageId !== undefined) {
    columns.push(['assistant_message_id', updates.assistantMessageId]);
  }
  if (updates.iterations !== undefined) columns.push(['iterations', updates.iterations]);
  if (updates.budgetSnapshot !== undefined) {
    columns.push([
      'budget_snapshot',
      updates.budgetSnapshot ? JSON.stringify(updates.budgetSnapshot) : null,
    ]);
  }
  if (updates.degraded !== undefined) columns.push(['degraded', updates.degraded ? 1 : 0]);
  if (updates.totalTokens !== undefined) columns.push(['total_tokens', updates.totalTokens]);
  if (updates.endedAt !== undefined) columns.push(['ended_at', updates.endedAt]);
  if (updates.error !== undefined) columns.push(['error', updates.error]);

  if (columns.length === 0) {
    return getRunWithSteps(runId)?.run;
  }

  const setClause = columns.map(([col]) => `${col} = ?`).join(', ');
  const row = getDb()
    .prepare(`UPDATE runs SET ${setClause} WHERE id = ? RETURNING *`)
    .get(...columns.map(([, value]) => value), runId) as RunRow | undefined;
  return row ? rowToRun(row) : undefined;
}

/** 追加一条步骤记录；preview 自动截断到 500 字符。 */
export function appendStep(params: AppendStepParams): RunStepRecord {
  const db = getDb();
  const id = generateId();
  const createdAt = new Date().toISOString();
  const argsPreview =
    params.argsPreview === null || params.argsPreview === undefined
      ? null
      : truncatePreview(params.argsPreview);
  const resultPreview =
    params.resultPreview === null || params.resultPreview === undefined
      ? null
      : truncatePreview(params.resultPreview);
  const isError = params.isError ?? false;

  db.prepare(
    `INSERT INTO run_steps
       (id, run_id, seq, type, tool_name, args_preview, result_preview, is_error, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.runId,
    params.seq,
    params.type,
    params.toolName ?? null,
    argsPreview,
    resultPreview,
    isError ? 1 : 0,
    params.durationMs,
    createdAt,
  );

  return {
    id,
    runId: params.runId,
    seq: params.seq,
    type: params.type,
    toolName: params.toolName ?? null,
    argsPreview,
    resultPreview,
    isError,
    durationMs: params.durationMs,
    createdAt,
  };
}

/** 按会话列出 Run（started_at 倒序），带每条 Run 的步骤计数。 */
export function listRunsBySession(sessionId: string): RunTraceWithStepCount[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM run_steps WHERE run_id = r.id) AS step_count
       FROM runs r
       WHERE r.session_id = ?
       ORDER BY r.started_at DESC`,
    )
    .all(sessionId) as RunRow[];
  return rows.map((row) => ({ ...rowToRun(row), stepCount: row.step_count ?? 0 }));
}

/** 取单条 Run 及其全部步骤（按 seq 升序）。 */
export function getRunWithSteps(
  runId: string,
): { run: RunTraceRecord; steps: RunStepRecord[] } | undefined {
  const db = getDb();
  const runRow = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined;
  if (!runRow) return undefined;
  const stepRows = db
    .prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY seq ASC')
    .all(runId) as RunStepRow[];
  return { run: rowToRun(runRow), steps: stepRows.map(rowToStep) };
}

/** 取某条用户消息在指定会话内触发的最新一条 Run。 */
export function latestRunByUserMessage(
  sessionId: string,
  userMessageId: string,
): RunTraceRecord | undefined {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM runs
       WHERE session_id = ? AND user_message_id = ?
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .get(sessionId, userMessageId) as RunRow | undefined;
  return row ? rowToRun(row) : undefined;
}

/**
 * 启动时清理僵尸 Run：将全部非终态（queued/in_progress/requires_action）
 * 批量置为 status='failed'、error='服务重启中断'。返回受影响行数。
 */
export function markStaleRunsOnBoot(): number {
  const placeholders = NON_TERMINAL_STATUSES.map(() => '?').join(', ');
  const info = getDb()
    .prepare(
      `UPDATE runs
       SET status = 'failed', error = '服务重启中断'
       WHERE status IN (${placeholders})`,
    )
    .run(...NON_TERMINAL_STATUSES);
  return info.changes;
}

// ---------------------------------------------------------------------------
// SQLite TraceCollector
// ---------------------------------------------------------------------------

/** createSqliteTraceCollector 的构造参数。 */
export interface SqliteTraceCollectorParams {
  sessionId: string;
  /** 触发本轮 Run 的真实用户消息 id（非 assistant 占位 id，NOT NULL）。 */
  userMessageId: string;
  assistantMessageId?: string | null;
  agentId?: string | null;
  jobId?: string | null;
}

/**
 * 构造落库到 runs / run_steps 的 TraceCollector。
 *
 * - 真实 userMessageId 只能经构造参数注入（同步链路 lifecycle 捕获
 *   createMessage 返回值、异步链路 worker 读 payload.realUserMessageId）；
 *   runner 上报的部分字段仅补充 sessionId 之外的标识与状态；
 * - 所有写库异常吞掉并 console.warn——trace 失败绝不影响 agent loop；
 * - onRunStart 重复调用只保留首行；run 未创建时 onStep / onRunEnd 跳过。
 */
export function createSqliteTraceCollector(
  params: SqliteTraceCollectorParams,
): TraceCollector {
  let runId: string | null = null;

  const safe = (label: string, write: () => void): void => {
    try {
      write();
    } catch (err) {
      console.warn(
        `[trace] ${label} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  };

  return {
    onRunStart(run) {
      safe('onRunStart', () => {
        if (runId !== null) return;
        const created = createRun({
          sessionId: params.sessionId,
          userMessageId: params.userMessageId,
          assistantMessageId:
            run.assistantMessageId ?? params.assistantMessageId ?? null,
          agentId: run.agentId ?? params.agentId ?? null,
          jobId: run.jobId ?? params.jobId ?? null,
          status: run.status ?? 'in_progress',
        });
        runId = created.id;
      });
    },
    onStep(step) {
      safe('onStep', () => {
        if (runId === null) return;
        appendStep({
          runId,
          seq: step.seq,
          type: step.type,
          toolName: step.toolName,
          argsPreview: step.argsPreview,
          resultPreview: step.resultPreview,
          isError: step.isError,
          durationMs: step.durationMs,
        });
      });
    },
    onRunEnd(run) {
      safe('onRunEnd', () => {
        if (runId === null) return;
        updateRun(runId, {
          status: run.status,
          stopReason: run.stopReason ?? null,
          iterations: run.iterations,
          budgetSnapshot: run.budgetSnapshot ?? null,
          degraded: run.degraded,
          totalTokens: run.totalTokens,
          endedAt: run.endedAt ?? new Date().toISOString(),
          error: run.error ?? null,
        });
      });
    },
  };
}
