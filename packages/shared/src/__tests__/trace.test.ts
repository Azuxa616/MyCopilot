import { describe, it, expect } from 'vitest';
import type { RunTraceRecord, RunStepRecord, TraceCollector } from '../trace.js';
import type { RunStatus } from '../run.js';
import type { BudgetBreakdown } from '../context.js';

const budget: BudgetBreakdown = {
  system: 600,
  tools: 1400,
  history: 3400,
  toolOutputs: 2800,
  working: 1000,
  headroom: 800,
  total: 10000,
};

describe('RunTraceRecord', () => {
  it('should create a valid RunTraceRecord with all fields', () => {
    const status: RunStatus = 'completed';
    const trace: RunTraceRecord = {
      id: 'run-1',
      sessionId: 'session-1',
      userMessageId: 'msg-user-1',
      assistantMessageId: 'msg-assistant-1',
      agentId: 'agent-1',
      jobId: 'job-1',
      status,
      stopReason: 'end_turn',
      iterations: 3,
      budgetSnapshot: budget,
      degraded: false,
      totalTokens: 9200,
      startedAt: '2026-08-28T00:00:00.000Z',
      endedAt: '2026-08-28T00:00:05.000Z',
      error: null,
    };
    expect(trace.status).toBe('completed');
    expect(trace.stopReason).toBe('end_turn');
    expect(trace.iterations).toBe(3);
    expect(trace.budgetSnapshot?.total).toBe(10000);
    expect(trace.degraded).toBe(false);
    expect(trace.totalTokens).toBe(9200);
  });

  it('should allow null for run-scoped optional fields', () => {
    const trace: RunTraceRecord = {
      id: 'run-2',
      sessionId: 'session-1',
      userMessageId: 'msg-user-2',
      assistantMessageId: null,
      agentId: null,
      jobId: null,
      status: 'failed',
      stopReason: null,
      iterations: 0,
      budgetSnapshot: null,
      degraded: false,
      totalTokens: 0,
      startedAt: '2026-08-28T00:00:00.000Z',
      endedAt: null,
      error: 'boom',
    };
    expect(trace.assistantMessageId).toBeNull();
    expect(trace.stopReason).toBeNull();
    expect(trace.budgetSnapshot).toBeNull();
    expect(trace.endedAt).toBeNull();
    expect(trace.error).toBe('boom');
  });
});

describe('RunStepRecord', () => {
  it('should create a valid llm_call step', () => {
    const step: RunStepRecord = {
      id: 'step-1',
      runId: 'run-1',
      seq: 1,
      type: 'llm_call',
      toolName: null,
      argsPreview: null,
      resultPreview: null,
      isError: false,
      durationMs: 120,
      createdAt: '2026-08-28T00:00:01.000Z',
    };
    expect(step.type).toBe('llm_call');
    expect(step.toolName).toBeNull();
    expect(step.durationMs).toBe(120);
  });

  it('should create a valid tool_exec step with previews', () => {
    const step: RunStepRecord = {
      id: 'step-2',
      runId: 'run-1',
      seq: 2,
      type: 'tool_exec',
      toolName: 'calculator',
      argsPreview: '{"expression":"2+3"}',
      resultPreview: '5',
      isError: false,
      durationMs: 3,
      createdAt: '2026-08-28T00:00:02.000Z',
    };
    expect(step.type).toBe('tool_exec');
    expect(step.toolName).toBe('calculator');
    expect(step.isError).toBe(false);
  });

  it('should narrow on the type discriminant exhaustively', () => {
    const steps: RunStepRecord[] = [
      {
        id: 'step-1',
        runId: 'run-1',
        seq: 1,
        type: 'llm_call',
        toolName: null,
        argsPreview: null,
        resultPreview: null,
        isError: false,
        durationMs: 120,
        createdAt: '2026-08-28T00:00:01.000Z',
      },
      {
        id: 'step-2',
        runId: 'run-1',
        seq: 2,
        type: 'tool_exec',
        toolName: 'calculator',
        argsPreview: '{"expression":"2+3"}',
        resultPreview: '5',
        isError: false,
        durationMs: 3,
        createdAt: '2026-08-28T00:00:02.000Z',
      },
    ];
    const tags = steps.map((step) => {
      switch (step.type) {
        case 'llm_call':
          return `llm_call@${step.seq}`;
        case 'tool_exec':
          return `tool_exec:${step.toolName}`;
        default: {
          const unreachable: never = step.type;
          return unreachable;
        }
      }
    });
    expect(tags).toEqual(['llm_call@1', 'tool_exec:calculator']);
  });
});

describe('TraceCollector', () => {
  it('should accept a plain-object implementation and return void from all hooks', () => {
    const events: string[] = [];
    const collector: TraceCollector = {
      onRunStart(run) {
        events.push(`run_start:${run.id ?? 'unknown'}`);
      },
      onStep(step) {
        events.push(`step:${step.seq}:${step.type}`);
      },
      onRunEnd(run) {
        events.push(`run_end:${run.status ?? 'unknown'}`);
      },
    };

    expect(collector.onRunStart({ id: 'run-1', status: 'queued' })).toBeUndefined();
    expect(collector.onStep({
      id: 'step-1',
      runId: 'run-1',
      seq: 1,
      type: 'llm_call',
      toolName: null,
      argsPreview: null,
      resultPreview: null,
      isError: false,
      durationMs: 120,
      createdAt: '2026-08-28T00:00:01.000Z',
    })).toBeUndefined();
    expect(collector.onRunEnd({ id: 'run-1', status: 'completed', stopReason: 'end_turn' })).toBeUndefined();

    expect(events).toEqual([
      'run_start:run-1',
      'step:1:llm_call',
      'run_end:completed',
    ]);
  });

  it('should record events in call order across a full run', () => {
    const events: string[] = [];
    const collector: TraceCollector = {
      onRunStart(run) {
        events.push(`start:${run.sessionId ?? ''}`);
      },
      onStep(step) {
        events.push(`step:${step.seq}`);
      },
      onRunEnd(run) {
        events.push(`end:${run.iterations ?? 0}`);
      },
    };

    collector.onRunStart({ sessionId: 'session-1' });
    collector.onStep({
      id: 'step-1',
      runId: 'run-1',
      seq: 1,
      type: 'tool_exec',
      toolName: 'calculator',
      argsPreview: null,
      resultPreview: null,
      isError: false,
      durationMs: 3,
      createdAt: '2026-08-28T00:00:01.000Z',
    });
    collector.onRunEnd({ iterations: 2 });

    expect(events).toEqual(['start:session-1', 'step:1', 'end:2']);
  });
});
