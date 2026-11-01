import { describe, it, expect } from 'vitest';
import {
  registerStream,
  unregisterStream,
  abortStream,
  getActiveStreamCount,
  appendRunEvent,
  setRunWaiting,
  isRunWaiting,
  attachRunSink,
  detachRunSink,
  closeRun,
  type RunEventSink,
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

describe('Run event buffer / waiting / sinks', () => {
  function makeSink(): RunEventSink & { written: string[]; closed: boolean } {
    const sink = {
      written: [] as string[],
      closed: false,
      write: async (frame: { event: string; data: string }) => {
        sink.written.push(`${frame.event}:${frame.data}`);
      },
      close: () => {
        sink.closed = true;
      },
    };
    return sink;
  }

  it('appendRunEvent buffers frames for replay', () => {
    appendRunEvent('buf-1', { event: 'delta', data: '"a"' });
    appendRunEvent('buf-1', { event: 'done', data: '{}' });
    const frames = attachRunSink('buf-1', makeSink());
    expect(frames.map((f) => f.event)).toEqual(['delta', 'done']);
    closeRun('buf-1');
  });

  it('attached sinks receive live events after replay snapshot', () => {
    const sink = makeSink();
    appendRunEvent('buf-2', { event: 'placeholder', data: '1' });
    attachRunSink('buf-2', sink);
    appendRunEvent('buf-2', { event: 'delta', data: '2' });
    expect(sink.written).toEqual(['delta:2']);
    closeRun('buf-2');
  });

  it('setRunWaiting / isRunWaiting; terminal event clears waiting', () => {
    expect(isRunWaiting('buf-3')).toBe(false);
    setRunWaiting('buf-3', true);
    expect(isRunWaiting('buf-3')).toBe(true);
    appendRunEvent('buf-3', { event: 'delta', data: 'x' });
    expect(isRunWaiting('buf-3')).toBe(true);
    appendRunEvent('buf-3', { event: 'done', data: '{}' });
    expect(isRunWaiting('buf-3')).toBe(false);
    closeRun('buf-3');
  });

  it('buffer caps frames to prevent unbounded growth', () => {
    for (let i = 0; i < 5000; i++) {
      appendRunEvent('buf-4', { event: 'delta', data: 'x'.repeat(100) });
    }
    const frames = attachRunSink('buf-4', makeSink());
    expect(frames.length).toBeLessThanOrEqual(2000);
    closeRun('buf-4');
  });

  it('closeRun closes sinks and stops delivery; unregisterStream also closes', () => {
    const sinkA = makeSink();
    attachRunSink('buf-5', sinkA);
    closeRun('buf-5');
    expect(sinkA.closed).toBe(true);

    registerStream('buf-6');
    const sinkB = makeSink();
    attachRunSink('buf-6', sinkB);
    unregisterStream('buf-6');
    expect(sinkB.closed).toBe(true);
  });

  it('detachRunSink stops fan-out to that sink', () => {
    const sink = makeSink();
    attachRunSink('buf-7', sink);
    detachRunSink('buf-7', sink);
    appendRunEvent('buf-7', { event: 'delta', data: 'x' });
    expect(sink.written).toEqual([]);
    closeRun('buf-7');
  });

  it('failing sink write removes it without breaking others', async () => {
    const bad = makeSink();
    bad.write = async () => {
      throw new Error('disconnected');
    };
    const good = makeSink();
    attachRunSink('buf-8', bad);
    attachRunSink('buf-8', good);
    appendRunEvent('buf-8', { event: 'delta', data: 'x' });
    await new Promise((r) => setTimeout(r, 0));
    expect(good.written).toEqual(['delta:x']);
    closeRun('buf-8');
  });
});
