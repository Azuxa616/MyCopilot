import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { ToolCall } from '@my-copilot/shared';
import {
  waitForConfirmation,
  resolveConfirmation,
  getPendingConfirmation,
  clearPendingConfirmations,
} from '../confirmation.js';

const sampleToolCall: ToolCall = {
  id: 'call-1',
  name: 'dangerous_action',
  arguments: '{}',
};

describe('confirmation store', () => {
  beforeEach(() => {
    clearPendingConfirmations();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolveConfirmation(true) resolves the promise to true', async () => {
    const callId = 'sess-1:call-1';
    const promise = waitForConfirmation(callId, sampleToolCall, 60_000);
    // Synchronously resolve before awaiting.
    const resolved = resolveConfirmation(callId, true);
    expect(resolved).toBe(true);

    const approved = await promise;
    expect(approved).toBe(true);
  });

  it('resolveConfirmation(false) resolves the promise to false', async () => {
    const callId = 'sess-2:call-2';
    const promise = waitForConfirmation(callId, sampleToolCall, 60_000);

    resolveConfirmation(callId, false);

    const approved = await promise;
    expect(approved).toBe(false);
  });

  it('timeout auto-rejects (resolves to false) after the deadline', async () => {
    const callId = 'sess-3:call-3';
    const promise = waitForConfirmation(callId, sampleToolCall, 1_000);

    // Advance fake timers past the timeout.
    vi.advanceTimersByTime(1_001);
    const approved = await promise;

    expect(approved).toBe(false);
    // The pending entry must be cleaned up after a timeout.
    expect(getPendingConfirmation(callId)).toBeUndefined();
  });

  it('resolveConfirmation returns false for a non-existent callId', () => {
    const result = resolveConfirmation('does-not-exist', true);
    expect(result).toBe(false);
  });

  it('getPendingConfirmation returns undefined for non-existent callId', () => {
    expect(getPendingConfirmation('unknown')).toBeUndefined();
  });

  it('getPendingConfirmation returns the toolCall and expiresAt for a pending call', () => {
    const callId = 'sess-4:call-4';
    vi.setSystemTime(1_000_000);
    const promise = waitForConfirmation(callId, sampleToolCall, 5_000);

    const pending = getPendingConfirmation(callId);
    expect(pending).toBeDefined();
    expect(pending!.toolCall).toBe(sampleToolCall);
    expect(pending!.expiresAt).toBe(1_000_000 + 5_000);

    // Cleanup: resolve so the dangling promise doesn't leak across tests.
    resolveConfirmation(callId, false);
    return promise;
  });

  it('a confirmed call cannot be resolved twice (returns false second time)', async () => {
    const callId = 'sess-5:call-5';
    const promise = waitForConfirmation(callId, sampleToolCall, 60_000);

    const first = resolveConfirmation(callId, true);
    const approved = await promise;

    const second = resolveConfirmation(callId, true);

    expect(first).toBe(true);
    expect(approved).toBe(true);
    expect(second).toBe(false); // already gone from the map
  });

  it('clearPendingConfirmations resolves all pending promises to false', async () => {
    const promiseA = waitForConfirmation('a', sampleToolCall, 60_000);
    const promiseB = waitForConfirmation('b', sampleToolCall, 60_000);

    clearPendingConfirmations();

    const [a, b] = await Promise.all([promiseA, promiseB]);
    expect(a).toBe(false);
    expect(b).toBe(false);
    expect(getPendingConfirmation('a')).toBeUndefined();
    expect(getPendingConfirmation('b')).toBeUndefined();
  });

  it('confirmation is isolated per callId — one session cannot resolve another', async () => {
    const promiseA = waitForConfirmation('sess-a:call-x', sampleToolCall, 60_000);
    // sess-b tries to resolve sess-a's call → no-op.
    const crossResolve = resolveConfirmation('sess-b:call-x', true);
    expect(crossResolve).toBe(false);

    // The real owner resolves it.
    resolveConfirmation('sess-a:call-x', true);
    const approved = await promiseA;
    expect(approved).toBe(true);
  });
});
