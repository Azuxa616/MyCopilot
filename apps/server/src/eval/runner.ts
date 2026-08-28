/**
 * Eval 场景执行器（todo 8）。
 *
 * ⚠️ 进程环境约定：场景 requiredEnv 的键集由 eval-env.ts 在模块求值期注入
 * （cli.ts / 测试文件的第一个 import 必须是 eval-env）。MYCOPILOT_E2E_TOOLS
 * 在 builtins/index.ts 模块求值期读取，运行时无法补注。
 *
 * DB 隔离：runScenario 在 eval 专用临时目录 initDatabase（关旧开新），
 * 与用户库完全隔离；该调用仅限 eval CLI 子进程 / 测试，server 主进程绝不调用。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  EvalRunResult,
  EvalScenario,
  RunStepRecord,
  RunTraceRecord,
} from '@my-copilot/shared';
import { initDatabase, getDb } from '../db/index.js';
import { createSession } from '../repo/session.js';
import { createMessage } from '../repo/message.js';
import {
  createSqliteTraceCollector,
  getRunWithSteps,
  latestRunByUserMessage,
} from '../repo/runTrace.js';
import { createEvalRun } from '../repo/eval.js';
import { resolveToolApproval } from '../tools/confirmation.js';
import { runAgentLoop } from '../agent-loop/runner.js';
import type { AgentLoopEvent } from '../agent-loop/runner.js';
import { scoreScenario } from './scorer.js';
import {
  buildDeterministicAdapter,
  registerEvalTools,
  resolveLiveAdapterPlan,
  selectScenarioTools,
} from './setup.js';
import type { EvalAdapterPlan } from './setup.js';

/** 防挂死护栏（Metis 修正）：deterministic 场景总超时。 */
const DETERMINISTIC_TIMEOUT_MS = 60_000;
/** live 场景总超时（真实 LLM 多轮 + 网络等待）。 */
const LIVE_TIMEOUT_MS = 300_000;

/** runScenario 的可选配置。 */
export interface RunScenarioOptions {
  /** 复用的数据目录（CLI 一次运行共享，实现清旧插新语义）；缺省自建 tmpdir/eval-* 并自清理。 */
  dataDir?: string;
  /** 保留临时库目录（调试）。 */
  keepDb?: boolean;
  /** 覆盖场景总超时（测试注入短超时验证兜底机制）。 */
  timeoutMs?: number;
  /** live 模式：指定 provider id（缺省取 DB enabled 首个）。 */
  providerId?: string;
  /** live 第几次 trial（记录 eval_runs.trial）；缺省 1。 */
  trial?: number;
}

/** 单次场景运行的全部产物。 */
export interface ScenarioRunResult {
  evalRun: EvalRunResult;
  runTrace: RunTraceRecord | null;
  steps: RunStepRecord[];
  sessionId: string;
  /** 运行期观察到的审批 id（approval_flow 断言数据源）。 */
  approvalIds: readonly string[];
  /** 实际使用的数据目录（--keep-db / 调试定位）。 */
  dataDir: string;
}

/**
 * 执行单个评估场景：独立临时 DB → 注册工具 → 创建 eval 专用会话与用户
 * 消息 → runAgentLoop（trace 落库 + 行为注入）→ 规则评分 → eval_runs 落库。
 */
export async function runScenario(
  scenario: EvalScenario,
  opts: RunScenarioOptions = {},
): Promise<ScenarioRunResult> {
  const ownsDir = opts.dataDir === undefined;
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), 'eval-'));

  try {
    // live 先读用户库解析 provider（只读），再切回 eval 临时库；
    // deterministic 路径绝不触碰用户 providers 表。
    const livePlan =
      scenario.mode === 'live' ? resolveLiveAdapterPlan(opts.providerId) : null;

    initDatabase(dataDir);
    registerEvalTools();
    const tools = selectScenarioTools(scenario);

    const session = createSession({ title: `[eval] ${scenario.id}` });
    // 真实用户消息：runs.user_message_id 的唯一合法来源（非 assistant 占位 id）。
    const userMsg = createMessage({
      sessionId: session.id,
      role: 'user',
      content: scenario.userMessage,
      status: 'sent',
    });
    const assistantMsg = createMessage({
      sessionId: session.id,
      role: 'assistant',
      content: '',
      status: 'sending',
    });

    // 捕获发给 adapter 的装配消息（degraded 断言的截断后缀校验依据）。
    let plan: EvalAdapterPlan;
    if (livePlan !== null) {
      plan = livePlan;
    } else if (scenario.script !== undefined) {
      plan = buildDeterministicAdapter(scenario.script);
    } else {
      throw new Error(`deterministic 场景 ${scenario.id} 缺少 script`);
    }
    const { adapter, adapterConfig, assembledMessages } = plan;

    // 场景总超时兜底：审批钩子挂死 / 脚本缺陷导致永久挂起时强制终止。
    const controller = new AbortController();
    let timedOut = false;
    const timeoutMs =
      opts.timeoutMs ??
      (scenario.mode === 'live' ? LIVE_TIMEOUT_MS : DETERMINISTIC_TIMEOUT_MS);
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const approvalIds: string[] = [];
    let toolResultCount = 0;
    const onEvent = (event: AgentLoopEvent): void => {
      switch (event.type) {
        case 'tool_confirmation_required':
          approvalIds.push(event.approval.approvalId);
          if (scenario.behavior?.approval !== undefined) {
            // 同步 resolve：requestToolApproval 的早退分支读取 settled 终态。
            resolveToolApproval(
              event.approval.approvalId,
              scenario.behavior.approval === 'approve',
            );
          }
          break;
        case 'tool_result': {
          toolResultCount += 1;
          const abortAfter = scenario.behavior?.abortAfterToolResults;
          if (abortAfter !== undefined && toolResultCount >= abortAfter) {
            // onEvent 在 runner 内被 await，同步 abort 后复查点立即生效。
            controller.abort();
          }
          break;
        }
        case 'llm_event':
        case 'tool_confirmation_settled':
        case 'agent_loop_end':
          break;
      }
    };

    const startedAt = Date.now();
    let result: Awaited<ReturnType<typeof runAgentLoop>>;
    try {
      result = await runAgentLoop({
        sessionId: session.id,
        userMessageId: assistantMsg.id,
        history: [],
        userContent: scenario.userMessage,
        tools,
        adapter,
        adapterConfig,
        abortSignal: controller.signal,
        onEvent,
        trace: createSqliteTraceCollector({
          sessionId: session.id,
          userMessageId: userMsg.id,
        }),
        maxIterations: scenario.maxSteps,
      });
    } finally {
      clearTimeout(timer);
    }
    const durationMs = Date.now() - startedAt;

    const runTrace = latestRunByUserMessage(session.id, userMsg.id) ?? null;
    const steps = runTrace
      ? (getRunWithSteps(runTrace.id)?.steps ?? [])
      : [];

    const score = scoreScenario({
      scenario,
      loopStatus: result.status,
      finalContent: result.content,
      runTrace,
      steps,
      assembledMessages,
      sessionId: session.id,
      approvalIds,
      timedOut,
    });

    const evalRun: EvalRunResult = {
      scenarioId: scenario.id,
      mode: scenario.mode,
      status: score.status,
      metrics: {
        steps_used: runTrace?.iterations ?? 0,
        llm_calls: steps.filter((s) => s.type === 'llm_call').length,
        duration_ms: durationMs,
        tokens_estimated: runTrace?.totalTokens ?? 0,
      },
      faultType: score.faultType,
      runTraceId: runTrace?.id ?? null,
      assertionResults: score.assertionResults,
    };

    createEvalRun({
      scenarioId: evalRun.scenarioId,
      mode: evalRun.mode,
      status: evalRun.status,
      trial: opts.trial ?? 1,
      metrics: evalRun.metrics,
      faultType: evalRun.faultType,
      runTraceId: evalRun.runTraceId,
      assertionResults: evalRun.assertionResults,
      endedAt: new Date().toISOString(),
    });

    return {
      evalRun,
      runTrace,
      steps,
      sessionId: session.id,
      approvalIds,
      dataDir,
    };
  } finally {
    if (ownsDir && !opts.keepDb) {
      try {
        getDb().close();
      } catch {
        // 已关闭或未初始化——忽略。
      }
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
}
