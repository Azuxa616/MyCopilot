import { describe, it, expect } from 'vitest';
import type {
  EvalScenario,
  EvalAssertion,
  EvalRunResult,
  EvalSnapshot,
} from '../eval.js';
import type { StreamEvent } from '../stream-event.js';

const toolCallScript: StreamEvent[][] = [
  [
    { type: 'tool_call_start', index: 0 },
    {
      type: 'tool_call_done',
      index: 0,
      id: 'call-1',
      name: 'calculator',
      arguments: '{"expression":"2+3"}',
    },
    { type: 'finish', reason: 'tool_calls' },
  ],
  [
    { type: 'content', text: '结果是 5' },
    { type: 'finish', reason: 'stop' },
  ],
];

describe('EvalScenario', () => {
  it('should create a valid deterministic scenario with script and metadata', () => {
    const scenario: EvalScenario = {
      id: 'multi-step-tool-chain',
      name: '多步工具链',
      description: 'LLM 两轮：第一轮并行发两个工具调用，第二轮文本结束',
      category: 'loop',
      mode: 'deterministic',
      tools: ['calculator', 'json_format'],
      userMessage: '请计算 2+3 并把结果格式化为 JSON',
      maxSteps: 10,
      script: toolCallScript,
      requiredEnv: { MYCOPILOT_E2E_TOOLS: '1' },
      replayable: true,
      assertions: [
        { kind: 'status', expected: 'completed' },
        { kind: 'tool_sequence', expected: ['calculator', 'json_format'] },
        { kind: 'final_contains', expected: '5' },
      ],
    };
    expect(scenario.mode).toBe('deterministic');
    expect(scenario.script).toHaveLength(2);
    expect(scenario.script?.[0]?.[0]?.type).toBe('tool_call_start');
    expect(scenario.requiredEnv?.MYCOPILOT_E2E_TOOLS).toBe('1');
    expect(scenario.replayable).toBe(true);
    expect(scenario.assertions).toHaveLength(3);
  });

  it('should create a valid live scenario with trials and no script', () => {
    const scenario: EvalScenario = {
      id: 'live-multi-step-tool-chain',
      name: '真实模型多步工具链',
      description: '真实 LLM 驱动的工具链一致性统计',
      category: 'task',
      mode: 'live',
      tools: ['calculator'],
      userMessage: '请计算 2+3',
      trials: 3,
      replayable: false,
      assertions: [{ kind: 'status', expected: 'completed' }],
    };
    expect(scenario.mode).toBe('live');
    expect(scenario.trials).toBe(3);
    expect(scenario.script).toBeUndefined();
    expect(scenario.replayable).toBe(false);
  });

  it('should accept behavior metadata for approval and abort scenarios', () => {
    const approval: EvalScenario = {
      id: 'approval-approve-flow',
      name: '审批通过流',
      description: '危险工具经审批后执行',
      category: 'safety',
      mode: 'deterministic',
      tools: ['e2e_danger_tool'],
      userMessage: '执行危险操作',
      behavior: { approval: 'approve' },
      assertions: [{ kind: 'approval_flow', expected: 'approve' }],
    };
    const abort: EvalScenario = {
      id: 'abort-mid-run',
      name: '中断场景',
      description: '在第 N 个工具结果后触发 abort',
      category: 'recovery',
      mode: 'deterministic',
      tools: ['calculator'],
      userMessage: '算一下',
      behavior: { abortAfterToolResults: 1 },
      assertions: [{ kind: 'status', expected: 'cancelled' }],
    };
    expect(approval.behavior?.approval).toBe('approve');
    expect(abort.behavior?.abortAfterToolResults).toBe(1);
  });
});

describe('EvalAssertion discriminated union', () => {
  it('should accept every assertion kind with its expected field', () => {
    const assertions: EvalAssertion[] = [
      { kind: 'status', expected: 'completed' },
      { kind: 'tool_sequence', expected: ['calculator', 'json_format'] },
      { kind: 'final_contains', expected: '5' },
      { kind: 'degraded', expected: true },
      { kind: 'summary_created', expected: true },
      { kind: 'approval_flow', expected: 'reject' },
      { kind: 'max_steps_hit', expected: true },
    ];
    expect(assertions.map((a) => a.kind)).toEqual([
      'status',
      'tool_sequence',
      'final_contains',
      'degraded',
      'summary_created',
      'approval_flow',
      'max_steps_hit',
    ]);
  });

  it('should narrow the union on the kind discriminant exhaustively', () => {
    const assertions: EvalAssertion[] = [
      { kind: 'status', expected: 'completed' },
      { kind: 'tool_sequence', expected: ['calculator'] },
      { kind: 'final_contains', expected: '5' },
      { kind: 'degraded', expected: false },
      { kind: 'summary_created', expected: true },
      { kind: 'approval_flow', expected: 'approve' },
      { kind: 'max_steps_hit', expected: true },
    ];

    const tags = assertions.map((assertion) => {
      switch (assertion.kind) {
        case 'status':
          return `status:${assertion.expected}`;
        case 'tool_sequence':
          return `tool_sequence:${assertion.expected.join('+')}`;
        case 'final_contains':
          return `final_contains:${assertion.expected}`;
        case 'degraded':
          return `degraded:${String(assertion.expected)}`;
        case 'summary_created':
          return `summary_created:${String(assertion.expected)}`;
        case 'approval_flow':
          return `approval_flow:${assertion.expected}`;
        case 'max_steps_hit':
          return `max_steps_hit:${String(assertion.expected)}`;
        default: {
          const unreachable: never = assertion;
          return unreachable;
        }
      }
    });

    expect(tags).toEqual([
      'status:completed',
      'tool_sequence:calculator',
      'final_contains:5',
      'degraded:false',
      'summary_created:true',
      'approval_flow:approve',
      'max_steps_hit:true',
    ]);
  });
});

describe('EvalRunResult', () => {
  it('should create a valid passing result with assertion details', () => {
    const result: EvalRunResult = {
      scenarioId: 'multi-step-tool-chain',
      mode: 'deterministic',
      status: 'pass',
      metrics: { steps_used: 2, llm_calls: 2, duration_ms: 145, tokens_estimated: 1200 },
      faultType: null,
      runTraceId: 'run-1',
      assertionResults: [
        { kind: 'status', pass: true, detail: '终态为 completed' },
        { kind: 'final_contains', pass: true, detail: '输出包含 5' },
      ],
    };
    expect(result.status).toBe('pass');
    expect(result.faultType).toBeNull();
    expect(result.runTraceId).toBe('run-1');
    expect(result.metrics.llm_calls).toBe(2);
    expect(result.assertionResults.every((a) => a.pass)).toBe(true);
  });

  it('should create a valid failing result with fault attribution', () => {
    const result: EvalRunResult = {
      scenarioId: 'repeat-call-guard',
      mode: 'deterministic',
      status: 'fail',
      metrics: { steps_used: 4, llm_calls: 4, duration_ms: 200, tokens_estimated: 2000 },
      faultType: 'repeat_blocked',
      runTraceId: 'run-2',
      assertionResults: [
        { kind: 'tool_sequence', pass: false, detail: '工具序列不匹配' },
      ],
    };
    expect(result.status).toBe('fail');
    expect(result.faultType).toBe('repeat_blocked');
  });
});

describe('EvalSnapshot', () => {
  it('should create a valid snapshot with aggregate metrics', () => {
    const pass: EvalRunResult = {
      scenarioId: 'multi-step-tool-chain',
      mode: 'deterministic',
      status: 'pass',
      metrics: { steps_used: 2, llm_calls: 2, duration_ms: 145, tokens_estimated: 1200 },
      faultType: null,
      runTraceId: 'run-1',
      assertionResults: [{ kind: 'status', pass: true, detail: '终态为 completed' }],
    };
    const fail: EvalRunResult = {
      scenarioId: 'tool-error-recovery',
      mode: 'deterministic',
      status: 'fail',
      metrics: { steps_used: 3, llm_calls: 3, duration_ms: 160, tokens_estimated: 1500 },
      faultType: 'other',
      runTraceId: 'run-2',
      assertionResults: [{ kind: 'status', pass: false, detail: '终态为 error' }],
    };
    const snapshot: EvalSnapshot = {
      generatedAt: '2026-08-28T00:00:00.000Z',
      gitCommit: '7c663b3',
      scenarios: [pass, fail],
      aggregate: { passRate: 0.5, avgSteps: 2.5, recoveryRate: 1 },
    };
    expect(snapshot.generatedAt).toBe('2026-08-28T00:00:00.000Z');
    expect(snapshot.gitCommit).toBe('7c663b3');
    expect(snapshot.scenarios).toHaveLength(2);
    expect(snapshot.aggregate.passRate).toBe(0.5);
    expect(snapshot.aggregate.avgSteps).toBe(2.5);
    expect(snapshot.aggregate.recoveryRate).toBe(1);
  });
});
