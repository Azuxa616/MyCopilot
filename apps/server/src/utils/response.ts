import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export function successResponse<T>(c: Context, data: T, status?: number) {
  return c.json({ code: 0, msg: 'ok', data }, (status ?? 200) as ContentfulStatusCode);
}

export function errorResponse(c: Context, status: number, msg: string, details?: unknown) {
  return c.json({ code: status, msg, data: details ?? null }, status as ContentfulStatusCode);
}
