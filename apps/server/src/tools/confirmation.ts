import type { ToolApproval } from '@my-copilot/shared';
import {
  createToolApproval,
  getToolApproval,
  settleToolApproval,
} from '../repo/tool-approval.js';

const DEFAULT_CONFIRMATION_TIMEOUT_MS = 300_000;
const CONFIRMATION_CACHE_TTL_MS = 30 * 60 * 1000;

interface ApprovalWaiter {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener: () => void;
}

export interface RequestToolApprovalParams {
  approval: Omit<
    ToolApproval,
    'approvalId' | 'state' | 'expiresAt' | 'createdAt' | 'updatedAt'
  >;
  signal?: AbortSignal;
  timeoutMs?: number;
  onRequired: (approval: ToolApproval) => void | Promise<void>;
  onSettled?: (approval: ToolApproval) => void | Promise<void>;
}

const approvalWaiters = new Map<string, ApprovalWaiter>();
const sessionConfirmations = new Map<string, number>();

export function isConfirmedThisSession(cacheKey: string): boolean {
  const expiresAt = sessionConfirmations.get(cacheKey);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    sessionConfirmations.delete(cacheKey);
    return false;
  }
  return true;
}

export function markConfirmedThisSession(cacheKey: string): void {
  sessionConfirmations.set(cacheKey, Date.now() + CONFIRMATION_CACHE_TTL_MS);
}

export function clearSessionConfirmations(sessionId: string): void {
  const prefix = `${sessionId}:`;
  for (const key of sessionConfirmations.keys()) {
    if (key.startsWith(prefix)) sessionConfirmations.delete(key);
  }
}

export function clearToolConfirmations(toolId: string): void {
  const marker = `:${toolId}:`;
  for (const key of sessionConfirmations.keys()) {
    if (key.includes(marker)) sessionConfirmations.delete(key);
  }
}

export function cancelToolApprovalsForSession(sessionId: string): void {
  clearSessionConfirmations(sessionId);
  for (const approvalId of approvalWaiters.keys()) {
    const approval = getToolApproval(approvalId);
    if (approval?.sessionId !== sessionId) continue;
    const cancelled = settleToolApproval(approvalId, 'cancelled');
    if (cancelled) approvalWaiters.get(approvalId)?.resolve(false);
  }
}

export async function requestToolApproval(
  params: RequestToolApprovalParams,
): Promise<boolean> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
  const approval = createToolApproval({
    ...params.approval,
    expiresAt: Date.now() + timeoutMs,
  });

  await params.onRequired(approval);

  const current = getToolApproval(approval.approvalId);
  if (current && current.state !== 'pending') {
    await params.onSettled?.(current);
    return current.state === 'approved';
  }

  if (params.signal?.aborted) {
    const cancelled = settleToolApproval(approval.approvalId, 'cancelled');
    if (cancelled) await params.onSettled?.(cancelled);
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const finish = async (approved: boolean, settled: ToolApproval): Promise<void> => {
      const waiter = approvalWaiters.get(approval.approvalId);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.removeAbortListener();
        approvalWaiters.delete(approval.approvalId);
      }
      await params.onSettled?.(settled);
      resolve(approved);
    };

    const timer = setTimeout(() => {
      const expired = settleToolApproval(approval.approvalId, 'expired');
      if (expired) void finish(false, expired);
    }, timeoutMs);

    const onAbort = (): void => {
      const cancelled = settleToolApproval(approval.approvalId, 'cancelled');
      if (cancelled) void finish(false, cancelled);
    };
    params.signal?.addEventListener('abort', onAbort, { once: true });

    approvalWaiters.set(approval.approvalId, {
      resolve: (approved) => {
        const settled = getToolApproval(approval.approvalId);
        if (settled) void finish(approved, settled);
      },
      timer,
      removeAbortListener: () => {
        params.signal?.removeEventListener('abort', onAbort);
      },
    });
  });
}

export function resolveToolApproval(
  approvalId: string,
  approved: boolean,
): ToolApproval | undefined {
  const settled = settleToolApproval(
    approvalId,
    approved ? 'approved' : 'rejected',
  );
  if (!settled) return undefined;
  approvalWaiters.get(approvalId)?.resolve(approved);
  return settled;
}

export function getPendingToolApproval(approvalId: string): ToolApproval | undefined {
  const approval = getToolApproval(approvalId);
  return approval?.state === 'pending' ? approval : undefined;
}

export function clearPendingConfirmations(): void {
  for (const approvalId of approvalWaiters.keys()) {
    const cancelled = settleToolApproval(approvalId, 'cancelled');
    if (cancelled) approvalWaiters.get(approvalId)?.resolve(false);
  }
  approvalWaiters.clear();
  sessionConfirmations.clear();
}
