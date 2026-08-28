/**
 * 规则断言评分器（todo 8）。
 *
 * 逐断言求值 EvalScenario.assertions → assertionResults + faultType 归因。
 * 输入是 runner 采集的 ScenarioEvidence（trace、步骤、装配消息快照、审批
 * id 等），本模块不执行场景、不开事务，只读 DB 终态（tool_approvals /
 * message_summaries）。
 */
import type {
  EvalAssertion,
  EvalAssertionResult,
  EvalFaultType,
  EvalScenario,
  RunStatus,
  RunStepRecord,
  RunTraceRecord,
} from '@my-copilot/shared';
import type { ChatMessage } from '../llm/base.js';
import type { AgentLoopStatus } from '../agent-loop/runner.js';
import { getToolApproval } from '../repo/tool-approval.js';
import { listSummariesBySession } from '../repo/summary.js';

/** AgentLoopStatus → RunStatus 终态映射（对齐 runner.ts TRACE_TERMINAL_BY_STATUS 的观察者口径）。 */
export const RUN_STATUS_BY_LOOP_STATUS: Readonly<
  Record<AgentLoopStatus, RunStatus>
> = {
  completed: 'completed',
  length_limited: 'incomplete',
  max_iterations: 'incomplete',
  aborted: 'cancelled',
  error: 'failed',
};

/** 与 assembler.ts 的 TOOL_OUTPUT_TRUNCATED_SUFFIX / TOOL_OUTPUT_MAX_CHARS 对齐（其模块私有常量未导出）。 */
const TOOL_OUTPUT_TRUNCATED_SUFFIX = '…[truncated]';
const TOOL_OUTPUT_MAX_CHARS = 2000;

/**
 * executor 拒绝审批时合成的稳定错误文案（executor.ts:102）。
 * 被拒绝的调用工具本体未执行——不计入 tool_sequence 的「已执行序列」
 * （approval-reject-flow 断言 tool_sequence 为空的依据）。
 */
const REJECTED_RESULT_MARKER = 'Tool execution was rejected or expired';

/** runner 合成 skipped 结果的稳定文案（runner.ts:754）——repeat_blocked 归因依据。 */
const SKIPPED_RESULT_MARKER = 'Tool execution skipped';

/** 评分所需的单次场景运行证据（由 runner 采集）。 */
export interface ScenarioEvidence {
  scenario: EvalScenario;
  /** runAgentLoop 的终态（runTrace 缺失时的 status 兜底映射来源）。 */
  loopStatus: AgentLoopStatus;
  /** 最终一轮的文本内容（final_contains 断言对象）。 */
  finalContent: string;
  runTrace: RunTraceRecord | null;
  steps: RunStepRecord[];
  /** 每次 chatCompletionStream 的装配消息快照（含 L2 摘要调用；末项是最终装配消息）。 */
  assembledMessages: readonly ChatMessage[][];
  sessionId: string;
  /** 运行期观察到的审批 id（approval_flow 断言据此查 tool_approvals 表终态）。 */
  approvalIds: readonly string[];
  /** 场景总超时兜底是否触发。 */
  timedOut: boolean;
}

/** 评分结果：断言逐项结果 + 总判定 + 失败归因。 */
export interface ScoreResult {
  status: 'pass' | 'fail';
  assertionResults: EvalAssertionResult[];
  faultType: EvalFaultType | null;
}

/** tool_sequence 匹配模式：精确相等 / 有序子序列。 */
export type ToolSequenceMatchMode = 'exact' | 'subset';

/**
 * trace 的 tool_exec 步骤 → 工具名序列。
 *
 * - 含 skipped 合成步骤（repeat-call-guard 断言 [calculator×3] 的依据）；
 * - 含真实执行错误步骤（tool-error-recovery 的 isError true→false 轨迹）；
 * - 不含被审批拒绝的步骤（工具本体未执行）。
 */
export function executedToolNames(
  steps: readonly RunStepRecord[],
): string[] {
  return steps
    .filter(
      (step) =>
        step.type === 'tool_exec' &&
        !(step.isError && (step.resultPreview ?? '').includes(REJECTED_RESULT_MARKER)),
    )
    .map((step) => step.toolName ?? '(unknown)');
}

/** tool_sequence 匹配：exact 要求逐项相等；subset 要求 expected 是 actual 的有序子序列。 */
export function matchToolSequence(
  actual: readonly string[],
  expected: readonly string[],
  mode: ToolSequenceMatchMode,
): boolean {
  if (mode === 'exact') {
    return (
      actual.length === expected.length &&
      expected.every((name, i) => name === actual[i])
    );
  }
  let cursor = 0;
  for (const name of actual) {
    if (cursor < expected.length && name === expected[cursor]) cursor += 1;
  }
  return cursor === expected.length;
}

function evaluateAssertion(
  assertion: EvalAssertion,
  evidence: ScenarioEvidence,
): EvalAssertionResult {
  switch (assertion.kind) {
    case 'status': {
      const actual =
        evidence.runTrace?.status ??
        RUN_STATUS_BY_LOOP_STATUS[evidence.loopStatus];
      return {
        kind: assertion.kind,
        pass: actual === assertion.expected,
        detail: `期望 ${assertion.expected}，实际 ${actual}`,
      };
    }
    case 'tool_sequence': {
      const actual = executedToolNames(evidence.steps);
      // 确定性脚本钉死行为 → 精确匹配（最强门禁）；live LLM 可能多调用
      // 工具 → 子集模式（按序用到了期望工具即算数）。
      const mode: ToolSequenceMatchMode =
        evidence.scenario.mode === 'live' ? 'subset' : 'exact';
      return {
        kind: assertion.kind,
        pass: matchToolSequence(actual, assertion.expected, mode),
        detail:
          `期望 [${assertion.expected.join(',')}]，实际 [${actual.join(',')}]` +
          `（${mode === 'exact' ? '精确' : '子集'}模式）`,
      };
    }
    case 'final_contains': {
      const pass = evidence.finalContent.includes(assertion.expected);
      return {
        kind: assertion.kind,
        pass,
        detail: pass
          ? `最终内容包含 "${assertion.expected}"`
          : `最终内容不包含 "${assertion.expected}"（长度 ${evidence.finalContent.length}）`,
      };
    }
    case 'degraded': {
      const actual = evidence.runTrace?.degraded ?? false;
      if (actual !== assertion.expected) {
        return {
          kind: assertion.kind,
          pass: false,
          detail: `期望 degraded=${assertion.expected}，实际 degraded=${actual}`,
        };
      }
      if (!assertion.expected) {
        return { kind: assertion.kind, pass: true, detail: 'degraded=false' };
      }
      // expected=true：按场景指令校验最终装配消息中 tool 消息的截断后缀
      // 与长度上限（禁止用 trace 的 resultPreview 断言——截断只作用于装配
      // 副本，与 preview 截断标记同形无鉴别力）。
      const finalMessages = evidence.assembledMessages.at(-1) ?? [];
      const truncated = finalMessages.filter(
        (msg) =>
          msg.role === 'tool' &&
          (msg.content ?? '').endsWith(TOOL_OUTPUT_TRUNCATED_SUFFIX),
      );
      const withinLimit = truncated.every(
        (msg) =>
          (msg.content ?? '').length <=
          TOOL_OUTPUT_MAX_CHARS + TOOL_OUTPUT_TRUNCATED_SUFFIX.length,
      );
      const pass = truncated.length > 0 && withinLimit;
      return {
        kind: assertion.kind,
        pass,
        detail: pass
          ? `最终装配消息含 ${truncated.length} 条截断 tool 消息（≤${TOOL_OUTPUT_MAX_CHARS}+后缀）`
          : `最终装配消息缺少以 ${TOOL_OUTPUT_TRUNCATED_SUFFIX} 结尾且 ≤${TOOL_OUTPUT_MAX_CHARS}+后缀 的 tool 消息`,
      };
    }
    case 'summary_created': {
      const created = listSummariesBySession(evidence.sessionId).length > 0;
      return {
        kind: assertion.kind,
        pass: created === assertion.expected,
        detail: `期望 summary_created=${assertion.expected}，实际 message_summaries ${created ? '有' : '无'} 新增`,
      };
    }
    case 'approval_flow': {
      const wanted = assertion.expected === 'approve' ? 'approved' : 'rejected';
      const states = evidence.approvalIds.map(
        (id) => getToolApproval(id)?.state ?? 'missing',
      );
      const pass =
        evidence.approvalIds.length > 0 && states.every((s) => s === wanted);
      return {
        kind: assertion.kind,
        pass,
        detail: `期望 tool_approvals 终态 ${wanted}，实际 [${states.join(',')}]（${evidence.approvalIds.length} 条审批）`,
      };
    }
    case 'max_steps_hit': {
      const hit = evidence.runTrace?.stopReason === 'max_steps';
      return {
        kind: assertion.kind,
        pass: hit === assertion.expected,
        detail: `期望 max_steps_hit=${assertion.expected}，实际 stopReason=${evidence.runTrace?.stopReason ?? 'null'}`,
      };
    }
    default: {
      const exhaustive: never = assertion;
      throw new Error(`未知断言 kind：${String(exhaustive)}`);
    }
  }
}

/**
 * 失败归因（τ-bench 式），优先级从高到低：
 * 1. 兜底超时触发 → timeout（仅 live/兜底路径产生；确定性场景理论上
 *    不触发——脚本缺陷或审批钩子挂死时由场景总超时兜底）；
 * 2. Run 终态 failed（脚本耗尽、意外异常）→ other（不属于目标完成类故障）；
 * 3. 存在 skipped isError 步骤 → repeat_blocked；
 * 4. tool_sequence 断言失败 → used_wrong_tool；
 * 5. 其余 → goal_incomplete。
 * 全部通过 → null。
 */
function attributeFault(
  evidence: ScenarioEvidence,
  assertionResults: readonly EvalAssertionResult[],
): EvalFaultType | null {
  if (assertionResults.every((r) => r.pass)) return null;
  if (evidence.timedOut) return 'timeout';
  if (evidence.loopStatus === 'error' || evidence.runTrace?.status === 'failed') {
    return 'other';
  }
  const hasSkipped = evidence.steps.some(
    (step) =>
      step.type === 'tool_exec' &&
      step.isError &&
      (step.resultPreview ?? '').includes(SKIPPED_RESULT_MARKER),
  );
  if (hasSkipped) return 'repeat_blocked';
  if (assertionResults.some((r) => r.kind === 'tool_sequence' && !r.pass)) {
    return 'used_wrong_tool';
  }
  return 'goal_incomplete';
}

/** 对单次场景运行证据求值全部断言。 */
export function scoreScenario(evidence: ScenarioEvidence): ScoreResult {
  const assertionResults = evidence.scenario.assertions.map((assertion) =>
    evaluateAssertion(assertion, evidence),
  );
  return {
    status: assertionResults.every((r) => r.pass) ? 'pass' : 'fail',
    assertionResults,
    faultType: attributeFault(evidence, assertionResults),
  };
}
