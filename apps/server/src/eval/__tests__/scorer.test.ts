/**
 * 规则断言评分器单元测试（todo 8）。
 *
 * 覆盖：各断言 kind 的 pass/fail 矩阵、faultType 归因映射、
 * RUN_STATUS_BY_LOOP_STATUS 终态映射、tool_sequence 精确/子集匹配、
 * degraded 的装配消息截断后缀校验（按 context-degradation 场景指令）。
 *
 * summary_created / approval_flow 走真实 repo（临时目录 DB）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  EvalAssertion,
  EvalScenario,
  RunStepRecord,
  RunTraceRecord,
  ToolApproval,
} from '@my-copilot/shared';
import { initDatabase, getDb } from '../../db/index.js';
import { createSession } from '../../repo/session.js';
import { createSummary } from '../../repo/summary.js';
import {
  createToolApproval,
  settleToolApproval,
} from '../../repo/tool-approval.js';
import {
  RUN_STATUS_BY_LOOP_STATUS,
  executedToolNames,
  matchToolSequence,
  scoreScenario,
} from '../scorer.js';
import type { ScenarioEvidence } from '../scorer.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeScenario(
  assertions: EvalAssertion[],
  overrides: Partial<EvalScenario> = {},
): EvalScenario {
  return {
    id: 'test-scenario',
    name: '测试场景',
    description: '',
    category: 'task',
    mode: 'deterministic',
    tools: [],
    userMessage: 'hello',
    replayable: true,
    assertions,
    ...overrides,
  };
}

function makeRun(overrides: Partial<RunTraceRecord> = {}): RunTraceRecord {
  return {
    id: 'run-1',
    sessionId: 'sess-1',
    userMessageId: 'um-1',
    assistantMessageId: null,
    agentId: null,
    jobId: null,
    status: 'completed',
    stopReason: 'end_turn',
    iterations: 2,
    budgetSnapshot: null,
    degraded: false,
    totalTokens: 100,
    startedAt: '2026-08-28T00:00:00.000Z',
    endedAt: '2026-08-28T00:00:01.000Z',
    error: null,
    ...overrides,
  };
}

let stepSeq = 0;
function makeStep(
  type: 'llm_call' | 'tool_exec',
  overrides: Partial<RunStepRecord> = {},
): RunStepRecord {
  stepSeq += 1;
  return {
    id: `step-${stepSeq}`,
    runId: 'run-1',
    seq: stepSeq,
    type,
    toolName: type === 'tool_exec' ? 'calculator' : null,
    argsPreview: null,
    resultPreview: null,
    isError: false,
    durationMs: 1,
    createdAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

function makeEvidence(
  overrides: Partial<ScenarioEvidence> = {},
): ScenarioEvidence {
  return {
    scenario: makeScenario([]),
    loopStatus: 'completed',
    finalContent: 'done',
    runTrace: makeRun(),
    steps: [],
    assembledMessages: [],
    sessionId: 'sess-1',
    approvalIds: [],
    timedOut: false,
    ...overrides,
  };
}

/** 构造 tool_approvals 插入参数（走 repo，保持与生产同链路）。 */
function approvalParams(sessionId: string): Omit<
  ToolApproval,
  'approvalId' | 'state' | 'createdAt' | 'updatedAt'
> {
  return {
    runId: 'run-1',
    jobId: null,
    sessionId,
    agentId: 'default',
    tool: {
      id: 'builtin-e2e-danger',
      name: 'e2e_danger_tool',
      source: 'built-in',
      sourceMcpId: null,
      policyVersion: 'builtin:e2e-danger:v1',
    },
    toolCallId: 'call-1',
    arguments: '{}',
    argumentsDigest: 'digest',
    resourceScope: 'args:digest',
    safetyLevel: 'danger',
    policyVersion: 'builtin:e2e-danger:v1',
    expiresAt: Date.now() + 300_000,
  };
}

/** 截断标记（与 assembler.ts TOOL_OUTPUT_TRUNCATED_SUFFIX 对齐）。 */
const SUFFIX = '…[truncated]';

describe('scoreScenario 断言矩阵', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-test-'));
    initDatabase(testDir);
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch {
      // ignore
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  // --- status ----------------------------------------------------------

  it('status：runTrace 终态匹配 expected → pass', () => {
    const result = scoreScenario(
      makeEvidence({ scenario: makeScenario([{ kind: 'status', expected: 'completed' }]) }),
    );
    expect(result.status).toBe('pass');
    expect(result.assertionResults[0]).toMatchObject({ kind: 'status', pass: true });
  });

  it('status：终态不匹配 → fail', () => {
    const result = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'status', expected: 'failed' }]),
        runTrace: makeRun({ status: 'cancelled', stopReason: 'user_interrupt' }),
      }),
    );
    expect(result.status).toBe('fail');
    expect(result.assertionResults[0]!.pass).toBe(false);
  });

  it('status：runTrace 缺失时按 loopStatus 映射兜底（aborted→cancelled）', () => {
    const result = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'status', expected: 'cancelled' }]),
        runTrace: null,
        loopStatus: 'aborted',
      }),
    );
    expect(result.assertionResults[0]!.pass).toBe(true);
  });

  it('RUN_STATUS_BY_LOOP_STATUS 覆盖全部五个终态映射', () => {
    expect(RUN_STATUS_BY_LOOP_STATUS).toEqual({
      completed: 'completed',
      length_limited: 'incomplete',
      max_iterations: 'incomplete',
      aborted: 'cancelled',
      error: 'failed',
    });
  });

  // --- tool_sequence ---------------------------------------------------

  it('tool_sequence：deterministic 精确匹配（含 skipped 合成步骤）→ pass', () => {
    const steps = [
      makeStep('tool_exec', { toolName: 'calculator', resultPreview: 'ok' }),
      makeStep('tool_exec', {
        toolName: 'calculator',
        isError: true,
        resultPreview: 'Tool execution skipped: a tool call with identical arguments was already attempted',
      }),
      makeStep('tool_exec', {
        toolName: 'calculator',
        isError: true,
        resultPreview: 'Tool execution skipped: ...',
      }),
    ];
    const result = scoreScenario(
      makeEvidence({
        scenario: makeScenario([
          { kind: 'tool_sequence', expected: ['calculator', 'calculator', 'calculator'] },
        ]),
        steps,
      }),
    );
    expect(result.assertionResults[0]!.pass).toBe(true);
  });

  it('tool_sequence：被审批拒绝的合成错误步骤不计入序列（approval-reject 语义）', () => {
    const rejected = makeStep('tool_exec', {
      toolName: 'e2e_danger_tool',
      isError: true,
      resultPreview: '[{"type":"text","text":"Tool execution was rejected or expired"}]',
    });
    expect(executedToolNames([rejected])).toEqual([]);
    const result = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'tool_sequence', expected: [] }]),
        steps: [rejected],
      }),
    );
    expect(result.assertionResults[0]!.pass).toBe(true);
  });

  it('tool_sequence：真实执行错误步骤计入序列（tool-error-recovery 语义）', () => {
    const steps = [
      makeStep('tool_exec', {
        toolName: 'calculator',
        isError: true,
        resultPreview: '[{"type":"text","text":"Invalid expression: abc"}]',
      }),
      makeStep('tool_exec', { toolName: 'calculator', resultPreview: 'ok' }),
    ];
    expect(executedToolNames(steps)).toEqual(['calculator', 'calculator']);
  });

  it('tool_sequence：序列错 → fail 且归因 used_wrong_tool', () => {
    const result = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'tool_sequence', expected: ['calculator'] }]),
        steps: [makeStep('tool_exec', { toolName: 'hash_text' })],
      }),
    );
    expect(result.status).toBe('fail');
    expect(result.faultType).toBe('used_wrong_tool');
  });

  it('tool_sequence：live 场景用子集模式（多余调用不判负）', () => {
    const steps = [
      makeStep('tool_exec', { toolName: 'calculator' }),
      makeStep('tool_exec', { toolName: 'calculator' }),
    ];
    const result = scoreScenario(
      makeEvidence({
        scenario: makeScenario(
          [{ kind: 'tool_sequence', expected: ['calculator'] }],
          { mode: 'live' },
        ),
        steps,
      }),
    );
    expect(result.assertionResults[0]!.pass).toBe(true);
    expect(result.assertionResults[0]!.detail).toContain('子集');
  });

  it('matchToolSequence：exact/subset 模式矩阵', () => {
    expect(matchToolSequence(['a', 'b'], ['a', 'b'], 'exact')).toBe(true);
    expect(matchToolSequence(['a', 'b', 'c'], ['a', 'b'], 'exact')).toBe(false);
    expect(matchToolSequence(['b', 'a'], ['a', 'b'], 'exact')).toBe(false);
    expect(matchToolSequence(['x', 'a', 'y', 'b'], ['a', 'b'], 'subset')).toBe(true);
    expect(matchToolSequence(['a', 'x', 'b'], ['b', 'a'], 'subset')).toBe(false);
    expect(matchToolSequence(['a'], [], 'subset')).toBe(true);
  });

  // --- final_contains ---------------------------------------------------

  it('final_contains：包含/不包含', () => {
    const pass = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'final_contains', expected: '5' }]),
        finalContent: '结果是 5',
      }),
    );
    expect(pass.assertionResults[0]!.pass).toBe(true);

    const fail = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'final_contains', expected: '5' }]),
        finalContent: '不知道',
      }),
    );
    expect(fail.assertionResults[0]!.pass).toBe(false);
  });

  // --- degraded ---------------------------------------------------------

  it('degraded=true：最终装配消息存在截断 tool 消息（后缀 + 长度上限）→ pass', () => {
    const truncated = 'x'.repeat(2000) + SUFFIX; // 恰好 2000+后缀
    const evidence = makeEvidence({
      scenario: makeScenario([{ kind: 'degraded', expected: true }]),
      runTrace: makeRun({ degraded: true }),
      assembledMessages: [
        [{ role: 'system', content: 's' }],
        [
          { role: 'system', content: 's' },
          { role: 'tool', content: truncated, toolCallId: 'call-b64-1' },
          { role: 'user', content: 'q' },
        ],
      ],
    });
    const result = scoreScenario(evidence);
    expect(result.assertionResults[0]!.pass).toBe(true);
  });

  it('degraded=true：超长（>2000+后缀）的截断 tool 消息 → fail', () => {
    const tooLong = 'x'.repeat(2001) + SUFFIX;
    const result = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'degraded', expected: true }]),
        runTrace: makeRun({ degraded: true }),
        assembledMessages: [[{ role: 'tool', content: tooLong, toolCallId: 'c1' }]],
      }),
    );
    expect(result.assertionResults[0]!.pass).toBe(false);
  });

  it('degraded=true：装配消息缺截断后缀（禁止用 resultPreview 断言的对照面）→ fail', () => {
    const result = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'degraded', expected: true }]),
        runTrace: makeRun({ degraded: true }),
        assembledMessages: [[{ role: 'tool', content: 'x'.repeat(146000), toolCallId: 'c1' }]],
      }),
    );
    expect(result.assertionResults[0]!.pass).toBe(false);
  });

  it('degraded=false：run 未降级 → pass；实际降级 → fail', () => {
    const pass = scoreScenario(
      makeEvidence({ scenario: makeScenario([{ kind: 'degraded', expected: false }]) }),
    );
    expect(pass.assertionResults[0]!.pass).toBe(true);

    const fail = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'degraded', expected: false }]),
        runTrace: makeRun({ degraded: true }),
      }),
    );
    expect(fail.assertionResults[0]!.pass).toBe(false);
  });

  // --- summary_created ---------------------------------------------------

  it('summary_created：message_summaries 有新增 → expected=true pass', () => {
    // message_summaries.session_id 同样有 sessions 外键。
    const session = createSession({});
    createSummary({
      sessionId: session.id,
      summary: '摘要',
      summarizedUpToMessageId: 'msg-1',
      tokenCount: 10,
    });
    const result = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'summary_created', expected: true }]),
        sessionId: session.id,
      }),
    );
    expect(result.assertionResults[0]!.pass).toBe(true);
  });

  it('summary_created：无摘要行 expected=true → fail；expected=false → pass', () => {
    const fail = scoreScenario(
      makeEvidence({ scenario: makeScenario([{ kind: 'summary_created', expected: true }]) }),
    );
    expect(fail.assertionResults[0]!.pass).toBe(false);

    const pass = scoreScenario(
      makeEvidence({ scenario: makeScenario([{ kind: 'summary_created', expected: false }]) }),
    );
    expect(pass.assertionResults[0]!.pass).toBe(true);
  });

  // --- approval_flow -----------------------------------------------------

  it('approval_flow：审批终态 approved → expected=approve pass', () => {
    // tool_approvals.session_id 有 sessions 外键，走真实 session 行。
    const session = createSession({});
    const approval = createToolApproval(approvalParams(session.id));
    settleToolApproval(approval.approvalId, 'approved');
    const result = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'approval_flow', expected: 'approve' }]),
        approvalIds: [approval.approvalId],
      }),
    );
    expect(result.assertionResults[0]!.pass).toBe(true);
  });

  it('approval_flow：终态 rejected → expected=approve fail', () => {
    const session = createSession({});
    const approval = createToolApproval(approvalParams(session.id));
    settleToolApproval(approval.approvalId, 'rejected');
    const result = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'approval_flow', expected: 'approve' }]),
        approvalIds: [approval.approvalId],
      }),
    );
    expect(result.assertionResults[0]!.pass).toBe(false);
  });

  it('approval_flow：无审批发生 → fail（规则不空转）', () => {
    const result = scoreScenario(
      makeEvidence({ scenario: makeScenario([{ kind: 'approval_flow', expected: 'reject' }]) }),
    );
    expect(result.assertionResults[0]!.pass).toBe(false);
  });

  // --- max_steps_hit -----------------------------------------------------

  it('max_steps_hit：stopReason=max_steps 匹配 expected', () => {
    const hit = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'max_steps_hit', expected: true }]),
        runTrace: makeRun({ status: 'incomplete', stopReason: 'max_steps' }),
      }),
    );
    expect(hit.assertionResults[0]!.pass).toBe(true);

    const miss = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'max_steps_hit', expected: true }]),
        runTrace: makeRun({ stopReason: 'end_turn' }),
      }),
    );
    expect(miss.assertionResults[0]!.pass).toBe(false);
  });
});

describe('faultType 归因映射', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-test-'));
    initDatabase(testDir);
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch {
      // ignore
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  it('全部断言通过 → faultType=null', () => {
    const result = scoreScenario(
      makeEvidence({ scenario: makeScenario([{ kind: 'status', expected: 'completed' }]) }),
    );
    expect(result.faultType).toBeNull();
  });

  it('兜底超时触发 → timeout（确定性场景理论不触发的对照注入路径）', () => {
    const result = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'status', expected: 'completed' }]),
        runTrace: makeRun({ status: 'cancelled' }),
        loopStatus: 'aborted',
        timedOut: true,
      }),
    );
    expect(result.faultType).toBe('timeout');
  });

  it('Run 终态 failed / loopStatus=error → other', () => {
    const result = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'status', expected: 'completed' }]),
        runTrace: makeRun({ status: 'failed', stopReason: 'error', error: '回放脚本太短' }),
        loopStatus: 'error',
      }),
    );
    expect(result.faultType).toBe('other');
  });

  it('存在 skipped isError 步骤且失败 → repeat_blocked', () => {
    const result = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'status', expected: 'completed' }]),
        runTrace: makeRun({ status: 'incomplete', stopReason: 'max_steps' }),
        steps: [
          makeStep('tool_exec', {
            isError: true,
            resultPreview: 'Tool execution skipped: ...',
          }),
        ],
      }),
    );
    expect(result.faultType).toBe('repeat_blocked');
  });

  it('仅 status 断言失败 → goal_incomplete', () => {
    const result = scoreScenario(
      makeEvidence({
        scenario: makeScenario([{ kind: 'status', expected: 'completed' }]),
        runTrace: makeRun({ status: 'incomplete', stopReason: 'max_tokens' }),
      }),
    );
    expect(result.faultType).toBe('goal_incomplete');
  });
});
