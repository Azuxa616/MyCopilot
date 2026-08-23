import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(
    status: number,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export function errorMiddleware() {
  return (err: Error, c: Context) => {
    if (err instanceof HttpError) {
      return c.json(
        { code: err.status, msg: err.message, data: null },
        err.status as ContentfulStatusCode,
      );
    }

    console.error(err.stack || err.message);
    return c.json(
      { code: 500, msg: 'Internal Server Error', data: null },
      500,
    );
  };
}
