import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { corsMiddleware } from '../cors.js';

function createTestApp(allowedOrigins: string[]) {
  const app = new Hono();
  app.use('*', corsMiddleware(allowedOrigins));
  app.get('/test', (c) => c.text('ok'));
  app.post('/test', (c) => c.text('created', 201));
  return app;
}

describe('corsMiddleware', () => {
  it('returns 204 with CORS headers on OPTIONS preflight', async () => {
    const app = createTestApp(['http://example.com']);

    const res = await app.request('/test', {
      method: 'OPTIONS',
      headers: { Origin: 'http://example.com' },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://example.com');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PATCH, DELETE, OPTIONS');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization');
  });

  it('sets Access-Control-Allow-Origin for whitelisted origin', async () => {
    const app = createTestApp(['http://example.com', 'http://localhost:3000']);

    const res = await app.request('/test', {
      method: 'GET',
      headers: { Origin: 'http://example.com' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://example.com');
  });

  it('does NOT set Access-Control-Allow-Origin for non-whitelisted origin', async () => {
    const app = createTestApp(['http://example.com']);

    const res = await app.request('/test', {
      method: 'GET',
      headers: { Origin: 'http://evil.com' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('allows all origins when wildcard * is in the list', async () => {
    const app = createTestApp(['*']);

    const res1 = await app.request('/test', {
      method: 'GET',
      headers: { Origin: 'http://example.com' },
    });
    const res2 = await app.request('/test', {
      method: 'GET',
      headers: { Origin: 'http://arbitrary.com' },
    });

    expect(res1.headers.get('Access-Control-Allow-Origin')).toBe('http://example.com');
    expect(res2.headers.get('Access-Control-Allow-Origin')).toBe('http://arbitrary.com');
  });
});
