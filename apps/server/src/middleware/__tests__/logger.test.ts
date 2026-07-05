import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loggerMiddleware } from '../logger.js';
import type { LogLevel } from '../logger.js';

function createTestApp(level: LogLevel) {
  const app = new Hono();
  app.use('*', loggerMiddleware(level));
  app.get('/test', (c) => c.text('ok'));
  app.get('/error', (c) => c.text('server error', 500));
  return app;
}

describe('loggerMiddleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs request in correct format at info level', async () => {
    const app = createTestApp('info');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await app.request('/test');

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toMatch(/^\[GET\] \/test → 200 \(\d+ms\)$/);
  });

  it('logs 5xx responses with console.error at error level', async () => {
    const app = createTestApp('error');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await app.request('/error');

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toMatch(/^\[GET\] \/error → 500 \(\d+ms\)$/);
  });

  it('does NOT log 2xx requests at warn level', async () => {
    const app = createTestApp('warn');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await app.request('/test');

    expect(spy).not.toHaveBeenCalled();
  });

  it('logs 4xx responses at warn level', async () => {
    const app = createTestApp('warn');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Create a route that returns 404
    await app.request('/not-found');

    // Since Hono returns 404 for unmatched routes, this should be logged
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toMatch(/^\[GET\] \/not-found → 404 \(\d+ms\)$/);
  });

  it('redacts Authorization header value at debug level', async () => {
    const app = createTestApp('debug');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await app.request('/test', {
      headers: { Authorization: 'Bearer my-secret-token-12345' },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0][0] as string;

    // The actual token should NEVER appear in logs
    expect(logged).not.toContain('my-secret-token-12345');
    expect(logged).not.toContain('Bearer my-secret-token-12345');

    // The redacted marker should appear
    expect(logged).toContain('<redacted>');
  });

  it('does not log when level is error and response is 2xx', async () => {
    const app = createTestApp('error');
    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const spyError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await app.request('/test');

    expect(spyLog).not.toHaveBeenCalled();
    expect(spyError).not.toHaveBeenCalled();
  });
});
