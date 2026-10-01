import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Model, Provider } from '@my-copilot/shared';
import { errorMiddleware } from '../../middleware/error.js';
import { modelCapabilitiesApp } from '../models.js';
import { ProviderError } from '../../llm/index.js';

vi.mock('../../repo/model.js', () => ({
  listModelsByProvider: vi.fn(),
  getModel: vi.fn(),
  createModel: vi.fn(),
  updateModel: vi.fn(),
  deleteModel: vi.fn(),
  setModelVisionCapability: vi.fn(),
  clearModelVisionCapability: vi.fn(),
}));
vi.mock('../../repo/provider.js', () => ({
  getProvider: vi.fn(),
}));
vi.mock('../../capability/probe.js', () => ({
  probeVisionByChat: vi.fn(),
}));
vi.mock('../../capability/resolve.js', () => ({
  resolveAndPersistVision: vi.fn(),
}));

import { getModel, setModelVisionCapability, clearModelVisionCapability } from '../../repo/model.js';
import { getProvider } from '../../repo/provider.js';
import { probeVisionByChat } from '../../capability/probe.js';
import { resolveAndPersistVision } from '../../capability/resolve.js';

type ApiResponse = {
  code: number;
  msg: string;
  data: Record<string, unknown>;
};

function createTestApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/models', modelCapabilitiesApp);
  return app;
}

function mockModel(over: Partial<Model> = {}): Model {
  return {
    id: 'm1',
    providerId: 'p1',
    name: 'deepseek-flash',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function mockProvider(over: Partial<Provider> = {}): Provider {
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

describe('modelCapabilities routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /:id/probe-vision', () => {
    it('returns 404 when the model does not exist', async () => {
      vi.mocked(getModel).mockReturnValue(undefined);

      const app = createTestApp();
      const res = await app.request('/models/m1/probe-vision', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 404 when the provider is missing', async () => {
      vi.mocked(getModel).mockReturnValue(mockModel());
      vi.mocked(getProvider).mockReturnValue(undefined);

      const app = createTestApp();
      const res = await app.request('/models/m1/probe-vision', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('skips and reports locked=true when manual lock is set (不写库不发请求)', async () => {
      vi.mocked(getModel).mockReturnValue(
        mockModel({ capabilities: { vision: 'no', sources: { vision: 'manual' } } }),
      );
      vi.mocked(getProvider).mockReturnValue(mockProvider());

      const app = createTestApp();
      const res = await app.request('/models/m1/probe-vision', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ApiResponse;
      const probe = body.data.probe as { method: string; vision: string; locked: boolean };
      expect(probe).toMatchObject({ method: 'skipped', vision: 'no', locked: true });
      expect(probeVisionByChat).not.toHaveBeenCalled();
      expect(setModelVisionCapability).not.toHaveBeenCalled();
    });

    it('ollama provider → resolveAndPersistVision (/api/show), method=provider-show', async () => {
      const updated = mockModel({
        capabilities: { vision: 'yes', sources: { vision: 'provider' } },
      });
      vi.mocked(getModel).mockReturnValue(mockModel());
      vi.mocked(getProvider).mockReturnValue(mockProvider({ type: 'ollama' }));
      vi.mocked(resolveAndPersistVision).mockResolvedValue(updated);

      const app = createTestApp();
      const res = await app.request('/models/m1/probe-vision', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ApiResponse;
      expect(body.data.model).toEqual(updated);
      expect(body.data.probe).toMatchObject({
        method: 'provider-show',
        vision: 'yes',
        source: 'provider',
      });
      expect(vi.mocked(resolveAndPersistVision).mock.calls[0]![0].id).toBe('m1');
      expect(probeVisionByChat).not.toHaveBeenCalled();
    });

    it('openai provider + successful chat probe → writes yes with source=probe', async () => {
      const updated = mockModel({
        capabilities: { vision: 'yes', sources: { vision: 'probe' } },
      });
      vi.mocked(getModel).mockReturnValue(mockModel());
      vi.mocked(getProvider).mockReturnValue(mockProvider());
      vi.mocked(probeVisionByChat).mockResolvedValue('yes');
      vi.mocked(setModelVisionCapability).mockReturnValue(updated);

      const app = createTestApp();
      const res = await app.request('/models/m1/probe-vision', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ApiResponse;
      expect(body.data.model).toEqual(updated);
      expect(body.data.probe).toMatchObject({ method: 'chat', vision: 'yes', source: 'probe' });
      expect(setModelVisionCapability).toHaveBeenCalledWith('m1', 'yes', 'probe');
    });

    it('openai provider + capability 400 → writes no with source=probe and 200', async () => {
      const updated = mockModel({
        capabilities: { vision: 'no', sources: { vision: 'probe' } },
      });
      vi.mocked(getModel).mockReturnValue(mockModel());
      vi.mocked(getProvider).mockReturnValue(mockProvider());
      vi.mocked(probeVisionByChat).mockRejectedValue(
        new ProviderError(
          'OpenAI request failed: Invalid content type. image_url is only supported by vision models.',
          400,
          { error: { message: 'Invalid content type. image_url is only supported by vision models.' } },
          'capability_vision_unsupported',
        ),
      );
      vi.mocked(setModelVisionCapability).mockReturnValue(updated);

      const app = createTestApp();
      const res = await app.request('/models/m1/probe-vision', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ApiResponse;
      expect(body.data.probe).toMatchObject({ method: 'chat', vision: 'no', source: 'probe' });
      expect((body.data.probe as { message?: string }).message).toContain('Invalid content type');
      expect(setModelVisionCapability).toHaveBeenCalledWith('m1', 'no', 'probe');
    });

    it('openai provider + network error → 502, no capability write', async () => {
      vi.mocked(getModel).mockReturnValue(mockModel());
      vi.mocked(getProvider).mockReturnValue(mockProvider());
      vi.mocked(probeVisionByChat).mockRejectedValue(
        new ProviderError('Failed to connect to OpenAI API: ECONNREFUSED', 502),
      );

      const app = createTestApp();
      const res = await app.request('/models/m1/probe-vision', { method: 'POST' });
      expect(res.status).toBe(502);
      const body = (await res.json()) as ApiResponse;
      expect(body.msg).toContain('ECONNREFUSED');
      expect(setModelVisionCapability).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /:id/capabilities', () => {
    it('sets manual capability (vision=yes)', async () => {
      const updated = mockModel({
        capabilities: { vision: 'yes', sources: { vision: 'manual' } },
      });
      vi.mocked(setModelVisionCapability).mockReturnValue(updated);

      const app = createTestApp();
      const res = await app.request('/models/m1/capabilities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vision: 'yes' }),
      });
      expect(res.status).toBe(200);
      expect(setModelVisionCapability).toHaveBeenCalledWith('m1', 'yes', 'manual');
      const body = (await res.json()) as ApiResponse;
      expect(body.data).toEqual(updated);
    });

    it('clears the manual lock (vision=null)', async () => {
      const updated = mockModel();
      vi.mocked(clearModelVisionCapability).mockReturnValue(updated);

      const app = createTestApp();
      const res = await app.request('/models/m1/capabilities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vision: null }),
      });
      expect(res.status).toBe(200);
      expect(clearModelVisionCapability).toHaveBeenCalledWith('m1');
    });

    it('returns 400 for invalid vision values', async () => {
      const app = createTestApp();
      const res = await app.request('/models/m1/capabilities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vision: 'maybe' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when the repo reports missing', async () => {
      vi.mocked(setModelVisionCapability).mockReturnValue(undefined);

      const app = createTestApp();
      const res = await app.request('/models/m1/capabilities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vision: 'yes' }),
      });
      expect(res.status).toBe(404);
    });
  });
});
