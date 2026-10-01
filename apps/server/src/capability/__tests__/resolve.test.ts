import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Model, Provider } from '@my-copilot/shared';
import { initDatabase, getDb } from '../../db/index.js';
import { createProvider } from '../../repo/provider.js';
import { createModel, getModel, setModelVisionCapability } from '../../repo/model.js';
import {
  resolveVisionCapability,
  resolveAndPersistVision,
  fetchOllamaShowCapabilities,
  clearOllamaShowCache,
} from '../resolve.js';
import { ProviderError } from '../../llm/index.js';

function makeModel(over: Partial<Model> = {}): Model {
  return {
    id: 'm1',
    providerId: 'p1',
    name: 'some-model',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function makeProvider(over: Partial<Provider> = {}): Provider {
  return {
    id: 'p1',
    name: 'P',
    type: 'openai',
    baseUrl: 'https://api.example.com/v1',
    apiKey: '',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('resolveVisionCapability (pure decision)', () => {
  it('layer 1: manual source short-circuits everything', async () => {
    const model = makeModel({
      capabilities: { vision: 'no', sources: { vision: 'manual' } },
    });
    const provider = makeProvider({ type: 'ollama' });
    const fetchOllamaShow = vi.fn();

    const result = await resolveVisionCapability(model, provider, { fetchOllamaShow });
    expect(result).toEqual({ vision: 'no', source: 'manual' });
    expect(fetchOllamaShow).not.toHaveBeenCalled(); // 手动仲裁，不再探测
  });

  it('layer 2: ollama /api/show containing vision → yes (source=provider)', async () => {
    const model = makeModel({ name: 'llama3.2-vision' }); // 故意不命中 catalog
    const provider = makeProvider({ type: 'ollama' });
    const fetchOllamaShow = vi.fn().mockResolvedValue(['completion', 'vision']);

    expect(await resolveVisionCapability(model, provider, { fetchOllamaShow })).toEqual({
      vision: 'yes',
      source: 'provider',
    });
  });

  it('layer 2: show 明确不含 vision → 回落 catalog 判定（show 可能滞后于模型替换）', async () => {
    const model = makeModel({ name: 'gpt-4o' }); // catalog 命中 yes
    const provider = makeProvider({ type: 'ollama' });
    const fetchOllamaShow = vi.fn().mockResolvedValue(['completion']);

    expect(await resolveVisionCapability(model, provider, { fetchOllamaShow })).toEqual({
      vision: 'yes',
      source: 'catalog',
    });
  });

  it('layer 2: provider 探测失败（网络/404）不阻塞解析，落入 catalog', async () => {
    const model = makeModel({ name: 'gpt-4o' });
    const provider = makeProvider({ type: 'ollama' });
    const fetchOllamaShow = vi.fn().mockRejectedValue(new ProviderError('show failed', 502));

    expect(await resolveVisionCapability(model, provider, { fetchOllamaShow })).toEqual({
      vision: 'yes',
      source: 'catalog',
    });
  });

  it('layer 2: openai 类型 provider 无原生信息，直接跳过', async () => {
    const model = makeModel({ name: 'deepseek-flash' });
    const provider = makeProvider({ type: 'openai' });
    const fetchOllamaShow = vi.fn();

    expect(await resolveVisionCapability(model, provider, { fetchOllamaShow })).toEqual({
      vision: 'yes',
      source: 'catalog',
    });
    expect(fetchOllamaShow).not.toHaveBeenCalled();
  });

  it('layer 4: 无任何信息 → unknown（无来源）', async () => {
    const model = makeModel({ name: 'totally-unknown-model' });
    const provider = makeProvider({ type: 'openai' });

    expect(await resolveVisionCapability(model, provider)).toEqual({ vision: 'unknown' });
  });
});

describe('fetchOllamaShowCapabilities (provider layer + cache)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearOllamaShowCache();
  });

  it('POSTs {baseUrl}/api/show and returns the capabilities array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ capabilities: ['completion', 'vision'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = makeProvider({
      id: 'p-ollama',
      type: 'ollama',
      baseUrl: 'http://localhost:11434/',
    });
    await expect(fetchOllamaShowCapabilities(provider, 'llava:13b')).resolves.toEqual([
      'completion',
      'vision',
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/api/show'); // 尾斜杠归一
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ model: 'llava:13b' });
  });

  it('caches per (provider, model) within TTL; clearOllamaShowCache forces refetch', async () => {
    // mockImplementation 每次返回新 Response（Response body 单次消费，不可复用）
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ capabilities: ['completion'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = makeProvider({ id: 'p-ollama', type: 'ollama' });
    await fetchOllamaShowCapabilities(provider, 'llama3');
    await fetchOllamaShowCapabilities(provider, 'llama3');
    expect(fetchMock).toHaveBeenCalledTimes(1); // 命中缓存

    clearOllamaShowCache();
    await fetchOllamaShowCapabilities(provider, 'llama3');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('non-200 → ProviderError (调用方在解析链中按"无信息"处理)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'model not found' }), { status: 404 }),
    ) as unknown as typeof fetch;

    const provider = makeProvider({ id: 'p-ollama', type: 'ollama' });
    await expect(fetchOllamaShowCapabilities(provider, 'nope')).rejects.toThrow(ProviderError);
  });
});

describe('resolveAndPersistVision (resolve + persist)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'capability-resolve-'));
    initDatabase(testDir);
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch {
      // ignore
    }
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('persists a catalog hit with source=catalog', async () => {
    const provider = createProvider({
      name: 'P',
      type: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: '',
    });
    const model = createModel(provider.id, { name: 'gpt-4o' });

    const updated = await resolveAndPersistVision(model, provider);
    expect(updated?.capabilities).toEqual({
      vision: 'yes',
      sources: { vision: 'catalog' },
    });
    expect(getModel(model.id)?.capabilities?.vision).toBe('yes');
  });

  it('leaves manual-locked models untouched (repo 锁兜底)', async () => {
    const provider = createProvider({
      name: 'P',
      type: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: '',
    });
    const model = createModel(provider.id, { name: 'gpt-4o' });
    setModelVisionCapability(model.id, 'no', 'manual');

    const updated = await resolveAndPersistVision(model, provider);
    expect(updated?.capabilities).toEqual({
      vision: 'no',
      sources: { vision: 'manual' },
    });
  });

  it('returns the model unchanged when resolution is unknown', async () => {
    const provider = createProvider({
      name: 'P',
      type: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: '',
    });
    const model = createModel(provider.id, { name: 'totally-unknown' });

    const updated = await resolveAndPersistVision(model, provider);
    expect(updated?.id).toBe(model.id);
    expect(updated?.capabilities).toBeUndefined();
  });
});
