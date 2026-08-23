import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { providersApp } from '../providers.js';
import { errorMiddleware } from '../../middleware/error.js';
import { initDatabase } from '../../db/index.js';
import { createProvider, getProvider } from '../../repo/provider.js';

const TEST_DATA_DIR = resolve('.test-data-providers-masking');

function createApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/api/providers', providersApp);
  return app;
}

const app = createApp();
let providerId = '';

beforeAll(() => {
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  initDatabase(TEST_DATA_DIR);
  const created = createProvider({
    name: 'P1',
    type: 'openai',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-1234567890abcdef',
    enabled: true,
  });
  providerId = created.id;
});

afterAll(() => {
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('providers apiKey masking', () => {
  it('GET / masks apiKey in list', async () => {
    const res = await app.request('/api/providers');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ apiKey: string }> };
    expect(body.data[0].apiKey).toBe('sk-1****cdef');
  });

  it('GET /:id masks apiKey in detail', async () => {
    const res = await app.request(`/api/providers/${providerId}`);
    const body = (await res.json()) as { data: { apiKey: string } };
    expect(body.data.apiKey).toBe('sk-1****cdef');
  });

  it('PATCH with masked apiKey keeps stored key', async () => {
    const res = await app.request(`/api/providers/${providerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed', apiKey: 'sk-1****cdef' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string; apiKey: string } };
    expect(body.data.name).toBe('Renamed');
    expect(body.data.apiKey).toBe('sk-1****cdef');
    // stored key untouched
    expect(getProvider(providerId)?.apiKey).toBe('sk-1234567890abcdef');
  });

  it('PATCH with empty apiKey keeps stored key', async () => {
    const res = await app.request(`/api/providers/${providerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: '' }),
    });
    expect(res.status).toBe(200);
    expect(getProvider(providerId)?.apiKey).toBe('sk-1234567890abcdef');
  });

  it('PATCH with a new real apiKey updates it', async () => {
    const res = await app.request(`/api/providers/${providerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-newkey-987654321' }),
    });
    expect(res.status).toBe(200);
    expect(getProvider(providerId)?.apiKey).toBe('sk-newkey-987654321');
  });

  it('POST response masks apiKey', async () => {
    const res = await app.request('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'P2',
        type: 'openai',
        baseUrl: 'https://api2.example.com',
        apiKey: 'sk-abcdef1234567890',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { apiKey: string } };
    expect(body.data.apiKey).toBe('sk-a****7890');
  });
});
