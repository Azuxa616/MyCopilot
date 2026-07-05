import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import {
  createProvider,
  getProvider,
  listProviders,
  updateProvider,
  deleteProvider,
} from '../provider.js';
import { createModel, getModel } from '../model.js';

describe('ProviderRepo', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-test-'));
    initDatabase(testDir);
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch {
      // ignore
    }
    if (testDir) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('createProvider → getProvider → verify fields', () => {
    const provider = createProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-test',
      enabled: true,
    });

    expect(provider.id).toBeDefined();
    expect(provider.name).toBe('OpenAI');
    expect(provider.type).toBe('openai');
    expect(provider.baseUrl).toBe('https://api.openai.com');
    expect(provider.apiKey).toBe('sk-test');
    expect(provider.enabled).toBe(true);
    expect(provider.createdAt).toBeDefined();
    expect(provider.updatedAt).toBeDefined();

    const fetched = getProvider(provider.id);
    expect(fetched).toEqual(provider);
  });

  it('deleteProvider → getProvider undefined + models cascade deleted', () => {
    const provider = createProvider({
      name: 'Test',
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      apiKey: '',
    });

    const model = createModel(provider.id, {
      name: 'llama2',
      enabled: true,
    });

    expect(getProvider(provider.id)).toBeDefined();
    expect(getModel(model.id)).toBeDefined();

    const deleted = deleteProvider(provider.id);
    expect(deleted).toBe(true);
    expect(getProvider(provider.id)).toBeUndefined();
    expect(getModel(model.id)).toBeUndefined();
  });

  it('updateProvider updates only provided fields', () => {
    const provider = createProvider({
      name: 'Original',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-original',
    });

    const updated = updateProvider(provider.id, { name: 'Updated' });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe('Updated');
    expect(updated!.type).toBe('openai');
    expect(updated!.baseUrl).toBe('https://api.openai.com');
    expect(updated!.apiKey).toBe('sk-original');

    const fetched = getProvider(provider.id);
    expect(fetched!.name).toBe('Updated');
  });

  it('listProviders returns all providers ordered by created_at DESC', () => {
    const p1 = createProvider({
      name: 'First',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: '',
    });

    const p2 = createProvider({
      name: 'Second',
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      apiKey: '',
    });

    const list = listProviders();
    expect(list).toHaveLength(2);
    const ids = list.map((p) => p.id);
    expect(ids).toContain(p1.id);
    expect(ids).toContain(p2.id);
  });
});
