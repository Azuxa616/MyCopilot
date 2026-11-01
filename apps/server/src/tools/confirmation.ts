import type { ToolApproval } from '@my-copilot/shared';
import { ASK_USER_TIMEOUT_CONFIG_KEY } from '@my-copilot/shared';
import { createToolApproval, getToolApproval, settleToolApproval } from '../repo/tool-approval.js';
import * as config from '../repo/config.js';

const DEFAULT_CONFIRMATION_TIMEOUT_MS = 300_000;
const CONFIRMATION_CACHE_TTL_MS = 30 * 60 * 1000;
const EXPIRED_QUESTION_PAYLOAD = '{"status":"expired","answers":[]}';
const CANCELLED_QUESTION_PAYLOAD = '{"status":"cancelled","answers":[]}';

interface ApprovalWaiter {
  resolve: (approved: boolean, payload?: string) => void;
  timer?: ReturnType<typeof setTimeout>;
  removeAbortListener: () => void;
}

export interface RequestToolApprovalParams {
  approval: Omit<ToolApproval, 'approvalId' | 'state' | 'expiresAt' | 'createdAt' | 'updatedAt'>;
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
    if (cancelled) approvalWaiters.get(approvalId)?.resolve(false, questionPayload(approval, CANCELLED_QUESTION_PAYLOAD));
  }
}

export async function requestToolApproval(params: RequestToolApprovalParams): Promise<boolean> {
  const result = await waitForApproval(params, params.timeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS);
  return result.approved;
}

export async function requestUserQuestion(params: RequestToolApprovalParams): Promise<string> {
  const configured = config.get(ASK_USER_TIMEOUT_CONFIG_KEY);
  const timeoutMs = configured === undefined ? 0 : Number(configured);
  const validTimeout = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  const result = await waitForApproval(params, validTimeout, EXPIRED_QUESTION_PAYLOAD);
  return result.payload ?? CANCELLED_QUESTION_PAYLOAD;
}

interface WaitResult {
  approved: boolean;
  payload?: string;
}

async function waitForApproval(
  params: RequestToolApprovalParams,
  timeoutMs: number,
  expiredPayload?: string,
): Promise<WaitResult> {
  const approval = createToolApproval({ ...params.approval, expiresAt: timeoutMs === 0 ? 0 : Date.now() + timeoutMs });
  await params.onRequired(approval);
  const current = getToolApproval(approval.approvalId);
  if (current && current.state !== 'pending') {
    await params.onSettled?.(current);
    return { approved: current.state === 'approved' };
  }
  if (params.signal?.aborted) {
    const cancelled = settleToolApproval(approval.approvalId, 'cancelled');
    if (cancelled) await params.onSettled?.(cancelled);
    return { approved: false, ...(expiredPayload === undefined ? {} : { payload: CANCELLED_QUESTION_PAYLOAD }) };
  }
  return new Promise<WaitResult>((resolve) => {
    const finish = async (approved: boolean, settled: ToolApproval, payload?: string): Promise<void> => {
      const waiter = approvalWaiters.get(approval.approvalId);
      if (waiter) {
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.removeAbortListener();
        approvalWaiters.delete(approval.approvalId);
      }
      await params.onSettled?.(settled);
      resolve({ approved, ...(payload === undefined ? {} : { payload }) });
    };
    const timer = timeoutMs === 0 ? undefined : setTimeout(() => {
      const expired = settleToolApproval(approval.approvalId, 'expired');
      if (expired) void finish(false, expired, expiredPayload);
    }, timeoutMs);
    const onAbort = (): void => {
      const cancelled = settleToolApproval(approval.approvalId, 'cancelled');
      if (cancelled) void finish(false, cancelled, expiredPayload === undefined ? undefined : CANCELLED_QUESTION_PAYLOAD);
    };
    params.signal?.addEventListener('abort', onAbort, { once: true });
    approvalWaiters.set(approval.approvalId, {
      resolve: (approved, payload) => {
        const settled = getToolApproval(approval.approvalId);
        if (settled) void finish(approved, settled, payload);
      },
      ...(timer === undefined ? {} : { timer }),
      removeAbortListener: () => params.signal?.removeEventListener('abort', onAbort),
    });
  });
}

export function resolveToolApproval(approvalId: string, approved: boolean, payload?: string): ToolApproval | undefined {
  const settled = settleToolApproval(approvalId, approved ? 'approved' : 'rejected');
  if (!settled) return undefined;
  approvalWaiters.get(approvalId)?.resolve(approved, payload);
  return settled;
}

export function getPendingToolApproval(approvalId: string): ToolApproval | undefined {
  const approval = getToolApproval(approvalId);
  return approval?.state === 'pending' ? approval : undefined;
}

export function clearPendingConfirmations(): void {
  for (const approvalId of approvalWaiters.keys()) {
    const approval = getToolApproval(approvalId);
    const cancelled = settleToolApproval(approvalId, 'cancelled');
    if (cancelled) approvalWaiters.get(approvalId)?.resolve(false, questionPayload(approval, CANCELLED_QUESTION_PAYLOAD));
  }
  approvalWaiters.clear();
  sessionConfirmations.clear();
}

function questionPayload(approval: ToolApproval | undefined, payload: string): string | undefined {
  return approval?.tool.name === 'ask_user' ? payload : undefined;
}
