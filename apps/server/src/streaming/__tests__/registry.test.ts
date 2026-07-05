import { describe, it, expect } from 'vitest';
import {
  registerStream,
  unregisterStream,
  abortStream,
  getActiveStreamCount,
} from '../registry.js';
import { HttpError } from '../../middleware/error.js';

describe('Stream Registry', () => {
  it('registerStream creates an AbortController and increments count', () => {
    expect(getActiveStreamCount()).toBe(0);

    const ac = registerStream('session-1');
    expect(ac).toBeInstanceOf(AbortController);
    expect(ac.signal.aborted).toBe(false);
    expect(getActiveStreamCount()).toBe(1);

    unregisterStream('session-1');
    expect(getActiveStreamCount()).toBe(0);
  });

  it('registerStream throws HttpError(409) when same session registers twice', () => {
    registerStream('session-dup');

    try {
      registerStream('session-dup');
      // Should not reach here
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(409);
    }

    unregisterStream('session-dup');
  });

  it('unregisterStream removes session from registry', () => {
    registerStream('session-remove');
    expect(getActiveStreamCount()).toBe(1);

    unregisterStream('session-remove');
    expect(getActiveStreamCount()).toBe(0);

    // Unregister a non-existent session should not throw
    unregisterStream('nonexistent');
    expect(getActiveStreamCount()).toBe(0);
  });

  it('abortStream aborts the controller and returns true', () => {
    const ac = registerStream('session-abort');
    expect(ac.signal.aborted).toBe(false);

    const result = abortStream('session-abort');
    expect(result).toBe(true);
    expect(ac.signal.aborted).toBe(true);
    expect(getActiveStreamCount()).toBe(0);
  });

  it('abortStream returns false for non-existent session', () => {
    const result = abortStream('nonexistent');
    expect(result).toBe(false);
  });

  it('getActiveStreamCount reflects register/unregister correctly', () => {
    expect(getActiveStreamCount()).toBe(0);

    registerStream('s1');
    registerStream('s2');
    expect(getActiveStreamCount()).toBe(2);

    unregisterStream('s1');
    expect(getActiveStreamCount()).toBe(1);

    unregisterStream('s2');
    expect(getActiveStreamCount()).toBe(0);
  });

  it('abortStream also removes from registry', () => {
    registerStream('session-clean');
    expect(getActiveStreamCount()).toBe(1);

    abortStream('session-clean');
    expect(getActiveStreamCount()).toBe(0);

    // Double abort should return false
    const result = abortStream('session-clean');
    expect(result).toBe(false);
  });
});
