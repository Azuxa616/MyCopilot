import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorMiddleware } from '../../middleware/error.js';
import { assetsApp } from '../assets.js';
import type { Asset } from '@my-copilot/shared';

vi.mock('../../repo/asset.js', () => ({
  createAsset: vi.fn(),
  getAsset: vi.fn(),
  listRecentAssets: vi.fn(),
}));

vi.mock('../../attachment/storage.js', () => ({
  writeAssetFile: vi.fn(async () => {}),
  readAssetFile: vi.fn(),
}));

import { createAsset, getAsset, listRecentAssets } from '../../repo/asset.js';
import { writeAssetFile, readAssetFile } from '../../attachment/storage.js';

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'a1',
    name: 'a.png',
    mimeType: 'image/png',
    size: 8,
    kind: 'image',
    sha256: 'h',
    source: 'upload',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createTestApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/assets', assetsApp);
  return app;
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngForm(name = 'a.png', type = 'image/png'): FormData {
  const form = new FormData();
  form.append('file', new Blob([PNG_BYTES], { type }), name);
  return form;
}

describe('assets route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /assets', () => {
    it('上传图片 → 201 + Asset（kind 由魔数判定）', async () => {
      vi.mocked(createAsset).mockReturnValue(makeAsset());
      const app = createTestApp();
      const res = await app.request('/assets', { method: 'POST', body: pngForm() });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.kind).toBe('image');
      expect(createAsset).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'a.png', mimeType: 'image/png', size: 8, kind: 'image' }),
      );
      expect(writeAssetFile).toHaveBeenCalledWith('a1', Buffer.from(PNG_BYTES));
    });

    it('缺少 file 字段 → 400', async () => {
      const app = createTestApp();
      const form = new FormData();
      form.append('other', 'x');
      const res = await app.request('/assets', { method: 'POST', body: form });
      expect(res.status).toBe(400);
    });

    it('超限 → 413（默认 10 MB）', async () => {
      const big = new Uint8Array(11 * 1024 * 1024);
      const app = createTestApp();
      const form = new FormData();
      form.append('file', new Blob([big], { type: 'image/png' }), 'big.png');
      const res = await app.request('/assets', { method: 'POST', body: form });
      expect(res.status).toBe(413);
    });
  });

  describe('GET /assets（列表）', () => {
    it('name 子串过滤 + 透传列表', async () => {
      vi.mocked(listRecentAssets).mockReturnValue([
        makeAsset({ id: 'a1', name: 'alpha.png' }),
        makeAsset({ id: 'a2', name: 'beta.md', kind: 'markdown' }),
      ]);
      const app = createTestApp();
      const res = await app.request('/assets?name=alp');
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('alpha.png');
    });

    it('无 name → 全量', async () => {
      vi.mocked(listRecentAssets).mockReturnValue([makeAsset()]);
      const app = createTestApp();
      const res = await app.request('/assets');
      const body = await res.json();
      expect(body.data).toHaveLength(1);
    });
  });

  describe('GET /assets/:id/meta 与 /raw', () => {
    it('meta 不存在 → 404', async () => {
      vi.mocked(getAsset).mockReturnValue(undefined);
      const app = createTestApp();
      const res = await app.request('/assets/nope/meta');
      expect(res.status).toBe(404);
    });

    it('raw 返回原始字节与 Content-Type', async () => {
      vi.mocked(getAsset).mockReturnValue(makeAsset());
      vi.mocked(readAssetFile).mockResolvedValue(Buffer.from(PNG_BYTES));
      const app = createTestApp();
      const res = await app.request('/assets/a1/raw');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(res.headers.get('Cache-Control')).toContain('immutable');
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.subarray(0, 4)).toEqual(Buffer.from(PNG_BYTES).subarray(0, 4));
    });

    it('raw 文件缺失 → 404', async () => {
      vi.mocked(getAsset).mockReturnValue(makeAsset());
      vi.mocked(readAssetFile).mockRejectedValue(new Error('ENOENT'));
      const app = createTestApp();
      const res = await app.request('/assets/a1/raw');
      expect(res.status).toBe(404);
    });
  });
});
