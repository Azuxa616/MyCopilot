import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { errorMiddleware, HttpError } from '../error.js';
import { successResponse, errorResponse } from '../../utils/response.js';

function createTestApp() {
  const app = new Hono();

  app.onError(errorMiddleware());

  app.get('/test/not-found', () => {
    throw new HttpError(404, 'not found');
  });

  app.get('/test/internal-error', () => {
    throw new Error('random');
  });

  app.get('/test/success', (c) => {
    return successResponse(c, { id: 1, name: 'test' });
  });

  app.get('/test/error-resp', (c) => {
    return errorResponse(c, 400, 'bad request', null);
  });

  return app;
}

describe('HttpError', () => {
  const app = createTestApp();

  it('should return 404 with structured JSON for HttpError', async () => {
    const res = await app.request('/test/not-found');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ code: 404, msg: 'not found', data: null });
  });

  it('should return 500 with no stack trace for generic Error', async () => {
    const res = await app.request('/test/internal-error');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ code: 500, msg: 'Internal Server Error', data: null });
    // Verify no stack trace is leaked to client
    expect(body).not.toHaveProperty('stack');
  });

  it('successResponse returns correct structure', async () => {
    const res = await app.request('/test/success');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ code: 0, msg: 'ok', data: { id: 1, name: 'test' } });
  });

  it('errorResponse returns correct structure', async () => {
    const res = await app.request('/test/error-resp');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ code: 400, msg: 'bad request', data: null });
  });
});
