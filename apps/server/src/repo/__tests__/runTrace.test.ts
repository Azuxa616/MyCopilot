import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BudgetBreakdown } from '@my-copilot/shared';
import { initDatabase, getDb } from '../../db/index.js';
import { createSession } from '../session.js';
import {
  truncatePreview,
  createRun,
  updateRun,
  appendStep,
  listRunsBySession,
  getRunWithSteps,
  latestRunByUserMessage,
  markStaleRunsOnBoot,
} from '../runTrace.js';

const BUDGET: BudgetBreakdown = {
  system: 120,
  tools: 280,
  history: 680,
  toolOutputs: 560,
  working: 200,
  headroom: 160,
  total: 2000,
};

describe('RunTraceRepo', () => {
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

  describe('truncatePreview', () => {
    it('keeps text at or under 500 characters untouched', () => {
      expect(truncatePreview('a'.repeat(499))).toBe('a'.repeat(499));
      expect(truncatePreview('a'.repeat(500))).toBe('a'.repeat(500));
    });

    it('truncates beyond 500 characters and appends the marker', () => {
      const truncated = truncatePreview('a'.repeat(600));
      expect(truncated).toBe('a'.repeat(500) + '…[truncated]');
      expect(truncated.endsWith('…[truncated]')).toBe(true);
    });
  });

  it('createRun persists a queued run with ISO startedAt and randomUUID id', () => {
    const run = createRun({
      sessionId,
      userMessageId: 'um-1',
      assistantMessageId: 'am-1',
      agentId: 'agent-1',
      jobId: 'job-1',
    });

    expect(run.id).toMatch(/[0-9a-f-]{36}/);
    expect(run.sessionId).toBe(sessionId);
    expect(run.userMessageId).toBe('um-1');
    expect(run.assistantMessageId).toBe('am-1');
    expect(run.agentId).toBe('agent-1');
    expect(run.jobId).toBe('job-1');
    expect(run.status).toBe('queued');
    expect(run.stopReason).toBeNull();
    expect(run.iterations).toBe(0);
    expect(run.budgetSnapshot).toBeNull();
    expect(run.degraded).toBe(false);
    expect(run.totalTokens).toBe(0);
    expect(run.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(run.endedAt).toBeNull();
    expect(run.error).toBeNull();

    const fetched = getRunWithSteps(run.id);
    expect(fetched?.run).toEqual(run);
    expect(fetched?.steps).toEqual([]);
  });

  it('createRun honours explicit startedAt and status overrides', () => {
    const run = createRun({
      sessionId,
      userMessageId: 'um-1',
      status: 'in_progress',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(run.status).toBe('in_progress');
    expect(run.startedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('appendStep stores steps ordered by seq and returns full records', () => {
    const run = createRun({ sessionId, userMessageId: 'um-1' });

    const llm = appendStep({ runId: run.id, seq: 1, type: 'llm_call', durationMs: 120 });
    const tool = appendStep({
      runId: run.id,
      seq: 2,
      type: 'tool_exec',
      toolName: 'calculator',
      argsPreview: '{"expression":"2+3"}',
      resultPreview: '5',
      isError: false,
      durationMs: 35,
    });

    expect(llm.type).toBe('llm_call');
    expect(llm.toolName).toBeNull();
    expect(llm.argsPreview).toBeNull();
    expect(llm.resultPreview).toBeNull();
    expect(llm.isError).toBe(false);
    expect(llm.durationMs).toBe(120);
    expect(llm.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    expect(tool.type).toBe('tool_exec');
    expect(tool.toolName).toBe('calculator');
    expect(tool.argsPreview).toBe('{"expression":"2+3"}');
    expect(tool.resultPreview).toBe('5');

    const fetched = getRunWithSteps(run.id);
    expect(fetched?.steps.map((s) => s.seq)).toEqual([1, 2]);
    expect(fetched?.steps[1].id).toBe(tool.id);
  });

  it('appendStep truncates previews longer than 500 characters (malformed input)', () => {
    const run = createRun({ sessionId, userMessageId: 'um-1' });
    const longArgs = 'x'.repeat(600);
    const longResult = 'y'.repeat(700);

    const step = appendStep({
      runId: run.id,
      seq: 1,
      type: 'tool_exec',
      toolName: 'http_fetch',
      argsPreview: longArgs,
      resultPreview: longResult,
      durationMs: 10,
    });

    expect(step.argsPreview).toBe('x'.repeat(500) + '…[truncated]');
    expect(step.resultPreview).toBe('y'.repeat(500) + '…[truncated]');

    const persisted = getRunWithSteps(run.id)?.steps[0];
    expect(persisted?.argsPreview).toBe('x'.repeat(500) + '…[truncated]');
    expect(persisted?.resultPreview).toBe('y'.repeat(500) + '…[truncated]');
  });

  it('updateRun merges terminal fields and leaves unspecified fields untouched', () => {
    const run = createRun({
      sessionId,
      userMessageId: 'um-1',
      assistantMessageId: 'am-1',
      jobId: 'job-1',
    });

    const updated = updateRun(run.id, {
      status: 'completed',
      stopReason: 'end_turn',
      iterations: 3,
      budgetSnapshot: BUDGET,
      degraded: true,
      totalTokens: 2000,
      endedAt: '2026-08-28T00:00:05.000Z',
    });

    expect(updated).toBeDefined();
    expect(updated?.status).toBe('completed');
    expect(updated?.stopReason).toBe('end_turn');
    expect(updated?.iterations).toBe(3);
    expect(updated?.budgetSnapshot).toEqual(BUDGET);
    expect(updated?.degraded).toBe(true);
    expect(updated?.totalTokens).toBe(2000);
    expect(updated?.endedAt).toBe('2026-08-28T00:00:05.000Z');
    // untouched merged fields
    expect(updated?.assistantMessageId).toBe('am-1');
    expect(updated?.jobId).toBe('job-1');
    expect(updated?.userMessageId).toBe('um-1');
    expect(updated?.error).toBeNull();

    // second, partial update only flips error path fields
    const failed = updateRun(run.id, { status: 'failed', error: 'boom' });
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('boom');
    expect(failed?.iterations).toBe(3);

    expect(updateRun('does-not-exist', { status: 'completed' })).toBeUndefined();
  });

  it('listRunsBySession orders by startedAt DESC and aggregates step counts', () => {
    const otherSession = createSession({ title: 'other' }).id;
    const old = createRun({
      sessionId,
      userMessageId: 'um-1',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    const newer = createRun({
      sessionId,
      userMessageId: 'um-2',
      startedAt: '2026-02-01T00:00:00.000Z',
    });
    createRun({ sessionId: otherSession, userMessageId: 'um-x' });

    appendStep({ runId: old.id, seq: 1, type: 'llm_call', durationMs: 10 });
    appendStep({ runId: old.id, seq: 2, type: 'tool_exec', toolName: 'hash', durationMs: 5 });

    const runs = listRunsBySession(sessionId);
    expect(runs.map((r) => r.id)).toEqual([newer.id, old.id]);
    expect(runs[0].stepCount).toBe(0);
    expect(runs[1].stepCount).toBe(2);

    const empty = listRunsBySession('no-such-session');
    expect(empty).toEqual([]);
  });

  it('getRunWithSteps returns undefined for unknown run id', () => {
    expect(getRunWithSteps('no-such-run')).toBeUndefined();
  });

  it('latestRunByUserMessage returns the newest run for that user message', () => {
    const first = createRun({
      sessionId,
      userMessageId: 'um-1',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    const second = createRun({
      sessionId,
      userMessageId: 'um-1',
      startedAt: '2026-02-01T00:00:00.000Z',
    });
    createRun({ sessionId, userMessageId: 'um-2' });

    expect(latestRunByUserMessage(sessionId, 'um-1')?.id).toBe(second.id);
    expect(latestRunByUserMessage(sessionId, 'um-1')?.id).not.toBe(first.id);

    // scoped to session
    const otherSession = createSession({ title: 'other' }).id;
    createRun({ sessionId: otherSession, userMessageId: 'um-1' });
    expect(latestRunByUserMessage(sessionId, 'um-1')?.id).toBe(second.id);

    expect(latestRunByUserMessage(sessionId, 'um-none')).toBeUndefined();
  });

  it('markStaleRunsOnBoot fails all non-terminal runs and leaves terminal runs untouched', () => {
    const statuses = [
      'queued',
      'in_progress',
      'requires_action',
      'completed',
      'cancelled',
      'failed',
      'incomplete',
      'expired',
    ] as const;
    const runs = statuses.map((status) =>
      createRun({ sessionId, userMessageId: 'um-1', status }),
    );

    const changed = markStaleRunsOnBoot();
    expect(changed).toBe(3);

    const byStatus = new Map(
      listRunsBySession(sessionId).map((r) => [r.id, r] as const),
    );
    for (const [i, status] of statuses.entries()) {
      const run = byStatus.get(runs[i].id);
      if (status === 'queued' || status === 'in_progress' || status === 'requires_action') {
        expect(run?.status).toBe('failed');
        expect(run?.error).toBe('服务重启中断');
      } else {
        expect(run?.status).toBe(status);
        expect(run?.error).toBeNull();
      }
    }

    // idempotent second boot: nothing left in non-terminal states
    expect(markStaleRunsOnBoot()).toBe(0);
  });
});
