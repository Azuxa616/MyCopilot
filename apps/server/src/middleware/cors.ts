import type { MiddlewareHandler } from 'hono';

export function corsMiddleware(allowedOrigins: string[]): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('Origin');

    if (origin) {
      const isAllowed = allowedOrigins.includes('*') || allowedOrigins.includes(origin);
      if (isAllowed) {
        c.header('Access-Control-Allow-Origin', origin);
        c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }
    }

    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }

    await next();
  };
}
