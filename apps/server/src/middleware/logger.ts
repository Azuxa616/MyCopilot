import type { MiddlewareHandler } from 'hono';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function loggerMiddleware(level: LogLevel): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;

    await next();

    const duration = Date.now() - start;
    const status = c.res.status;

    if (!shouldLogForLevel(level, status)) {
      return;
    }

    let logLine = `[${method}] ${path} \u2192 ${status} (${duration}ms)`;

    if (level === 'debug') {
      const authHeader = c.req.header('Authorization');
      const extra: string[] = [];
      if (authHeader) {
        extra.push('auth=<redacted>');
      }
      if (extra.length > 0) {
        logLine += ` ${extra.join(' ')}`;
      }
    }

    const logFn = status >= 500 ? console.error : console.log;
    logFn(logLine);
  };
}

function shouldLogForLevel(level: LogLevel, status: number): boolean {
  switch (level) {
    case 'debug':
    case 'info':
      return true;
    case 'warn':
      return status >= 400;
    case 'error':
      return status >= 500;
  }
}
