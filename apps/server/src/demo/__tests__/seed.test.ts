// apps/server/src/demo/__tests__/seed.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { initDatabase } from '../../db/index.js';
import { seedDemoData } from '../seed.js';
import { listProviders, deleteProvider } from '../../repo/provider.js';
import { listAllEnabledModels } from '../../repo/model.js';

const TEST_DATA_DIR = resolve('.test-data-demo-seed');

beforeAll(() => {
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  initDatabase(TEST_DATA_DIR);
});

afterAll(() => {
  try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('seedDemoData', () => {
  it('seeds provider+model from env, then is idempotent', () => {
    process.env.DEMO_PROVIDER_BASE_URL = 'https://api.example.com';
    process.env.DEMO_PROVIDER_API_KEY = 'sk-demo';
    process.env.DEMO_PROVIDER_MODEL = 'glm-4-flash';
    process.env.DEMO_PROVIDER_NAME = 'Demo';

    const first = seedDemoData();
    expect(first.seeded).toBe(true);
    expect(listProviders()).toHaveLength(1);
    expect(listAllEnabledModels()).toHaveLength(1);
    expect(listProviders()[0].baseUrl).toBe('https://api.example.com');

    const second = seedDemoData();
    expect(second.seeded).toBe(false);
    expect(listProviders()).toHaveLength(1);
    expect(listAllEnabledModels()).toHaveLength(1);
  });

  it('throws when providers empty but env incomplete', () => {
    for (const p of listProviders()) deleteProvider(p.id);
    delete process.env.DEMO_PROVIDER_BASE_URL;
    delete process.env.DEMO_PROVIDER_API_KEY;
    delete process.env.DEMO_PROVIDER_MODEL;
    delete process.env.DEMO_PROVIDER_NAME;

    expect(() => seedDemoData()).toThrow(/DEMO_PROVIDER/);
  });
});
