import { describe, it, expect, afterEach, vi } from 'vitest';
import { testProvider } from '../tester.js';

describe('testProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return success with latencyMs for 200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });

    const result = await testProvider('openai', 'https://api.openai.com', 'sk-test');

    expect(result.success).toBe(true);
    expect(typeof result.latencyMs).toBe('number');
  });

  it('should return auth error for 401 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    const result = await testProvider('openai', 'https://api.openai.com', 'invalid-key');

    expect(result.success).toBe(false);
    expect(result.errorClass).toBe('auth');
    expect(result.message).toBe('Invalid API key');
  });

  it('should return notfound error for 404 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const result = await testProvider('ollama', 'http://localhost:11434');

    expect(result.success).toBe(false);
    expect(result.errorClass).toBe('notfound');
    expect(result.message).toBe('Invalid endpoint');
  });

  it('should return network error when fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    const result = await testProvider('openai', 'https://api.openai.com', 'sk-test');

    expect(result.success).toBe(false);
    expect(result.errorClass).toBe('network');
    expect(result.message).toBe('Unreachable');
  });

  it('should handle timeout and return network error within 5.5s', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => {
      return new Promise((_resolve, reject) => {
        const onAbort = () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        };
        options?.signal?.addEventListener('abort', onAbort);
      });
    });

    const start = performance.now();
    const result = await testProvider('openai', 'https://api.openai.com', 'sk-test');
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5500);
    expect(result.success).toBe(false);
    expect(result.errorClass).toBe('network');
  }, 15000);
});
