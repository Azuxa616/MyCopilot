import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolApproval } from '@my-copilot/shared';
import { initDatabase, getDb } from '../../db/index.js';
import { createSession } from '../../repo/session.js';
import {
  requestToolApproval,
  resolveToolApproval,
  getPendingToolApproval,
  clearPendingConfirmations,
  isConfirmedThisSession,
  markConfirmedThisSession,
  type RequestToolApprovalParams,
} from '../confirmation.js';

// --- Helpers ---------------------------------------------------------------

// 当前用例的 session id（beforeEach 里创建真实 session 后赋值）
let sessionId = 'sess-1';

/** 构造一条审批参数（requestToolApproval 的 approval 载荷）。 */
function makeApprovalParams(
  overrides: Partial<RequestToolApprovalParams['approval']> = {},
): RequestToolApprovalParams['approval'] {
  return {
    runId: 'run-1',
    jobId: null,
    sessionId,
    agentId: 'default',
    tool: {
      id: 'tool-1',
      name: 'dangerous_action',
      source: 'mcp',
      sourceMcpId: 'mcp-1',
      policyVersion: 'pv-1',
    },
    toolCallId: 'call-1',
    arguments: '{}',
    argumentsDigest: 'deadbeef',
    resourceScope: 'args:deadbeef',
    safetyLevel: 'danger',
    policyVersion: 'pv-1',
    ...overrides,
  };
}

/**
 * 发起一次审批等待，并通过 onRequired 捕获生成的 approvalId，
 * 供 resolveToolApproval / getPendingToolApproval 使用。
 */
function startApproval(overrides: Partial<RequestToolApprovalParams> = {}) {
  let approvalId = '';
  const onRequired = vi.fn((approval: ToolApproval) => {
    approvalId = approval.approvalId;
  });
  const onSettled = vi.fn();
  const promise = requestToolApproval({
    approval: makeApprovalParams(),
    timeoutMs: 60_000,
    onRequired,
    onSettled,
    ...overrides,
  });
  return {
    promise,
    onRequired,
    onSettled,
    get approvalId() {
      return approvalId;
    },
  };
}

// --- Tests -----------------------------------------------------------------

describe('confirmation store', () => {
  let testDir: string;

  beforeEach(() => {
    // 每个用例独立的临时 SQLite（与 repo 层测试同模式）
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-test-'));
    initDatabase(testDir);
    // tool_approvals.session_id 有外键约束，需先建真实 session
    sessionId = createSession({}).id;
    clearPendingConfirmations();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('resolveToolApproval(true) resolves the requestToolApproval promise to true', async () => {
    const waiting = startApproval();
    await vi.waitFor(() => expect(waiting.onRequired).toHaveBeenCalled());

    const settled = resolveToolApproval(waiting.approvalId, true);
    expect(settled?.state).toBe('approved');

    const approved = await waiting.promise;
    expect(approved).toBe(true);
    // 结算回调收到 approved 状态的审批
    expect(waiting.onSettled).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: waiting.approvalId, state: 'approved' }),
    );
  });

  it('resolveToolApproval(false) resolves the promise to false', async () => {
    const waiting = startApproval();
    await vi.waitFor(() => expect(waiting.onRequired).toHaveBeenCalled());

    resolveToolApproval(waiting.approvalId, false);

    const approved = await waiting.promise;
    expect(approved).toBe(false);
    expect(waiting.onSettled).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'rejected' }),
    );
  });

  it('timeout auto-rejects (resolves to false) after the deadline', async () => {
    const waiting = startApproval({ timeoutMs: 1_000 });
    await vi.waitFor(() => expect(waiting.onRequired).toHaveBeenCalled());

    // Advance fake timers past the timeout.
    vi.advanceTimersByTime(1_001);
    const approved = await waiting.promise;

    expect(approved).toBe(false);
    expect(waiting.onSettled).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'expired' }),
    );
    // The pending entry must be cleaned up after a timeout.
    expect(getPendingToolApproval(waiting.approvalId)).toBeUndefined();
  });

  it('resolveToolApproval returns undefined for a non-existent approvalId', () => {
    const result = resolveToolApproval('does-not-exist', true);
    expect(result).toBeUndefined();
  });

  it('getPendingToolApproval returns undefined for a non-existent approvalId', () => {
    expect(getPendingToolApproval('unknown')).toBeUndefined();
  });

  it('getPendingToolApproval returns the pending approval with expiresAt = now + timeout', async () => {
    vi.setSystemTime(1_000_000);
    const waiting = startApproval({ timeoutMs: 5_000 });
    await vi.waitFor(() => expect(waiting.onRequired).toHaveBeenCalled());

    const pending = getPendingToolApproval(waiting.approvalId);
    expect(pending).toBeDefined();
    expect(pending!.toolCallId).toBe('call-1');
    expect(pending!.tool.name).toBe('dangerous_action');
    expect(pending!.state).toBe('pending');
    expect(pending!.expiresAt).toBe(1_000_000 + 5_000);

    // Cleanup: resolve so the dangling promise doesn't leak across tests.
    resolveToolApproval(waiting.approvalId, false);
    await waiting.promise;
  });

  it('a settled approval cannot be resolved twice (returns undefined second time)', async () => {
    const waiting = startApproval();
    await vi.waitFor(() => expect(waiting.onRequired).toHaveBeenCalled());

    const first = resolveToolApproval(waiting.approvalId, true);
    const approved = await waiting.promise;

    const second = resolveToolApproval(waiting.approvalId, true);

    expect(first?.state).toBe('approved');
    expect(approved).toBe(true);
    expect(second).toBeUndefined(); // 已结算，repo 拒绝二次结算
    // Settled 回调只触发一次
    expect(waiting.onSettled).toHaveBeenCalledTimes(1);
  });

  it('clearPendingConfirmations resolves all pending promises to false', async () => {
    const waitingA = startApproval({ approval: makeApprovalParams({ toolCallId: 'call-a' }) });
    const waitingB = startApproval({ approval: makeApprovalParams({ toolCallId: 'call-b' }) });
    await vi.waitFor(() => {
      expect(waitingA.onRequired).toHaveBeenCalled();
      expect(waitingB.onRequired).toHaveBeenCalled();
    });

    clearPendingConfirmations();

    const [a, b] = await Promise.all([waitingA.promise, waitingB.promise]);
    expect(a).toBe(false);
    expect(b).toBe(false);
    expect(getPendingToolApproval(waitingA.approvalId)).toBeUndefined();
    expect(getPendingToolApproval(waitingB.approvalId)).toBeUndefined();
    // 会话内确认缓存也被一并清空
    markConfirmedThisSession('sess-1:cache');
    expect(isConfirmedThisSession('sess-1:cache')).toBe(true);
    clearPendingConfirmations();
    expect(isConfirmedThisSession('sess-1:cache')).toBe(false);
  });

  it('confirmation is isolated per approvalId — one call cannot resolve another', async () => {
    const waitingA = startApproval({ approval: makeApprovalParams({ toolCallId: 'call-x' }) });
    const waitingB = startApproval({ approval: makeApprovalParams({ toolCallId: 'call-y' }) });
    await vi.waitFor(() => {
      expect(waitingA.onRequired).toHaveBeenCalled();
      expect(waitingB.onRequired).toHaveBeenCalled();
    });

    // 用 A 的审批 ID 无法结算 B
    resolveToolApproval(waitingA.approvalId, true);
    const approvedA = await waitingA.promise;
    expect(approvedA).toBe(true);
    expect(waitingB.onSettled).not.toHaveBeenCalled();

    // B 仍处于 pending，可由自己的 ID 正常结算
    const pendingB = getPendingToolApproval(waitingB.approvalId);
    expect(pendingB?.state).toBe('pending');
    resolveToolApproval(waitingB.approvalId, false);
    const approvedB = await waitingB.promise;
    expect(approvedB).toBe(false);
  });
});
