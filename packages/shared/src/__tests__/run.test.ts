import { describe, it, expect } from 'vitest';
import { DEFAULT_LOOP_GUARD_CONFIG } from '../run.js';
import type {
  LoopGuardConfig,
  RunContext,
  RunStep,
  RunStatus,
  StopReason,
} from '../run.js';

describe('DEFAULT_LOOP_GUARD_CONFIG', () => {
  it('should have correct values', () => {
    expect(DEFAULT_LOOP_GUARD_CONFIG.maxSteps).toBe(10);
    expect(DEFAULT_LOOP_GUARD_CONFIG.maxConcurrentTools).toBe(4);
    expect(DEFAULT_LOOP_GUARD_CONFIG.enableRepeatDetection).toBe(true);
    expect(DEFAULT_LOOP_GUARD_CONFIG.tokenBudgetThreshold).toBeUndefined();
  });

  it('should conform to LoopGuardConfig', () => {
    const config: LoopGuardConfig = DEFAULT_LOOP_GUARD_CONFIG;
    expect(config.maxSteps).toBe(10);
  });
});

describe('run types', () => {
  it('should accept valid union values', () => {
    const status: RunStatus = 'requires_action';
    const stopReason: StopReason = 'tool_use';
    expect(status).toBe('requires_action');
    expect(stopReason).toBe('tool_use');
  });

  it('should create a valid RunStep', () => {
    const step: RunStep = {
      id: 'step-1',
      runId: 'run-1',
      type: 'message_creation',
      status: 'pending',
      createdAt: '2026-08-15T00:00:00.000Z',
    };
    expect(step.type).toBe('message_creation');
    expect(step.status).toBe('pending');
  });

  it('should create a valid RunContext with a BudgetBreakdown from context.ts', () => {
    const ctx: RunContext = {
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [{ id: 'call-1', name: 'calculator', arguments: '{}' }],
        },
        { role: 'tool', content: '42', toolCallId: 'call-1' },
      ],
      budget: {
        system: 600,
        tools: 1400,
        history: 3400,
        toolOutputs: 2800,
        working: 1000,
        headroom: 800,
        total: 10000,
      },
      degraded: false,
    };
    expect(ctx.budget.total).toBe(10000);
    expect(ctx.messages[0]?.role).toBe('user');
    expect(ctx.degraded).toBe(false);
  });
});
