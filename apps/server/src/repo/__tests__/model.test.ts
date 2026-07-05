import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, getDb } from '../../db/index.js';
import { createProvider } from '../provider.js';
import {
  createModel,
  getModel,
  listModelsByProvider,
  listAllEnabledModels,
  updateModel,
  deleteModel,
} from '../model.js';
import { createSession, getSession } from '../session.js';

describe('ModelRepo', () => {
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

  it('createModel → getModel → verify fields', () => {
    const provider = createProvider({
      name: 'Test',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: '',
    });

    const model = createModel(provider.id, {
      name: 'gpt-4',
      displayName: 'GPT-4',
      enabled: true,
    });

    expect(model.id).toBeDefined();
    expect(model.providerId).toBe(provider.id);
    expect(model.name).toBe('gpt-4');
    expect(model.displayName).toBe('GPT-4');
    expect(model.enabled).toBe(true);

    const fetched = getModel(model.id);
    expect(fetched).toEqual(model);
  });

  it('listModelsByProvider returns only models for that provider', () => {
    const p1 = createProvider({
      name: 'P1',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: '',
    });

    const p2 = createProvider({
      name: 'P2',
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      apiKey: '',
    });

    const m1 = createModel(p1.id, { name: 'gpt-4' });
    const m2 = createModel(p1.id, { name: 'gpt-3.5' });
    createModel(p2.id, { name: 'llama2' });

    const list = listModelsByProvider(p1.id);
    expect(list).toHaveLength(2);
    expect(list.map((m) => m.id)).toContain(m1.id);
    expect(list.map((m) => m.id)).toContain(m2.id);
  });

  it('listAllEnabledModels returns only enabled models', () => {
    const provider = createProvider({
      name: 'Test',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: '',
    });

    const enabled = createModel(provider.id, { name: 'gpt-4', enabled: true });
    createModel(provider.id, { name: 'gpt-3.5', enabled: false });

    const list = listAllEnabledModels();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(enabled.id);
  });

  it('updateModel updates only provided fields', () => {
    const provider = createProvider({
      name: 'Test',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: '',
    });

    const model = createModel(provider.id, {
      name: 'gpt-4',
      displayName: 'GPT-4',
      enabled: true,
    });
    const updated = updateModel(model.id, { name: 'gpt-4-turbo' });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe('gpt-4-turbo');
    expect(updated!.displayName).toBe('GPT-4');
    expect(updated!.enabled).toBe(true);
  });

  it('deleteModel sets sessions.model_id to NULL', () => {
    const provider = createProvider({
      name: 'Test',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: '',
    });

    const model = createModel(provider.id, { name: 'gpt-4' });
    const session = createSession({ title: 'Test', modelId: model.id });

    expect(session.modelId).toBe(model.id);

    deleteModel(model.id);

    const fetched = getSession(session.id);
    expect(fetched).toBeDefined();
    expect(fetched!.modelId).toBeNull();
  });
});
