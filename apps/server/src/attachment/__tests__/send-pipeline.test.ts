import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAssetsFromFiles, resolveAssetsFromIds } from '../send-pipeline';
import { createAsset, getAsset } from '../../repo/asset';
import { writeAssetFile } from '../storage';
import { initDatabase, getDb } from '../../db/index.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('send-pipeline', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-test-'));
    process.env.DATA_DIR = testDir;
    initDatabase(testDir);
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch {
      // ignore
    }
    delete process.env.DATA_DIR;
    if (testDir) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  describe('resolveAssetsFromFiles（multipart 兼容通道）', () => {
    it('图片 → 资产化 + imageParts；文本 → 资产化 + AttachmentText', async () => {
      const outcome = await resolveAssetsFromFiles([
        { name: 'a.png', type: 'image/png', data: PNG },
        { name: 'n.txt', type: 'text/plain', data: Buffer.from('NOTE') },
      ]);

      expect(outcome.warnings).toHaveLength(0);
      expect(outcome.imageParts).toHaveLength(1);
      expect(outcome.attachmentsMeta).toHaveLength(2);
      expect(outcome.attachmentTexts).toEqual([{ name: 'n.txt', content: 'NOTE' }]);

      // 资产真实落库 + 落盘
      const firstPart = outcome.imageParts[0]!;
      if (firstPart.type !== 'image') throw new Error('expected image part');
      const asset = getAsset(firstPart.assetId);
      expect(asset?.kind).toBe('image');
      expect(asset?.name).toBe('a.png');
    });

    it('不支持的类型 → warnings（fail-soft，由路由层转 422）', async () => {
      const outcome = await resolveAssetsFromFiles([
        { name: 'x.doc', type: 'application/msword', data: Buffer.from('legacy') },
      ]);
      expect(outcome.warnings[0]).toContain('x.doc');
      expect(outcome.attachmentsMeta).toHaveLength(0);
    });
  });

  describe('resolveAssetsFromIds（JSON 新管道）', () => {
    it('图片资产 → imageParts；文本资产 → 重读字节提取 AttachmentText', async () => {
      const img = createAsset({ name: 'p.png', mimeType: 'image/png', size: PNG.length, kind: 'image', sha256: 'h1' });
      await writeAssetFile(img.id, PNG);
      const txt = createAsset({ name: 'n.md', mimeType: 'text/markdown', size: 2, kind: 'markdown', sha256: 'h2' });
      await writeAssetFile(txt.id, Buffer.from('# T'));

      const outcome = await resolveAssetsFromIds([img.id, txt.id]);

      expect(outcome.warnings).toHaveLength(0);
      expect(outcome.imageParts).toEqual([{ type: 'image', assetId: img.id }]);
      expect(outcome.attachmentTexts).toEqual([{ name: 'n.md', content: '# T' }]);
      expect(outcome.attachmentsMeta.map((m) => m.assetId)).toEqual([img.id, txt.id]);
    });

    it('资产不存在 → warning', async () => {
      const outcome = await resolveAssetsFromIds(['ghost']);
      expect(outcome.warnings[0]).toContain('ghost');
    });

    it('元数据在、文件缺失 → warning（fail-soft）', async () => {
      const txt = createAsset({ name: 'gone.txt', mimeType: 'text/plain', size: 1, kind: 'text', sha256: 'h' });
      // 故意不写文件
      const outcome = await resolveAssetsFromIds([txt.id]);
      expect(outcome.warnings[0]).toContain('gone.txt');
    });
  });
});
