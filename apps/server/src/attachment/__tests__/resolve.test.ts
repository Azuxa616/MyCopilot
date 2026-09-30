import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MessagePart } from '@my-copilot/shared';
import { applyImagePolicy, resolveWireImages, hasImageParts, HISTORY_IMAGE_WINDOW } from '../resolve';
import { createAsset } from '../../repo/asset';
import { writeAssetFile } from '../storage';
import { initDatabase, getDb } from '../../db/index.js';

const mk = (assetId: string) => ({ type: 'image' as const, assetId });

describe('applyImagePolicy（纯策略）', () => {
  const parts: MessagePart[] = [mk('a'), { type: 'text', text: '说明' }, mk('b')];

  it('当轮（age=0）：原样', () => {
    expect(applyImagePolicy(parts, 0)).toEqual(parts);
  });
  it('当轮原样保留 detail', () => {
    const withDetail: MessagePart[] = [{ type: 'image', assetId: 'a', detail: 'high' }];
    expect(applyImagePolicy(withDetail, 0)).toEqual(withDetail);
  });
  it(`age 1..${HISTORY_IMAGE_WINDOW}：图片强制 low，文本透传`, () => {
    expect(applyImagePolicy(parts, 3)).toEqual([
      { type: 'image', assetId: 'a', detail: 'low' },
      { type: 'text', text: '说明' },
      { type: 'image', assetId: 'b', detail: 'low' },
    ]);
  });
  it('age = 窗口边界值仍保留（low）', () => {
    expect(applyImagePolicy([mk('a')], HISTORY_IMAGE_WINDOW)).toEqual([
      { type: 'image', assetId: 'a', detail: 'low' },
    ]);
  });
  it('超出窗口：图片丢弃、文本保留', () => {
    expect(applyImagePolicy(parts, HISTORY_IMAGE_WINDOW + 1)).toEqual([
      { type: 'text', text: '说明' },
    ]);
  });
});

describe('resolveWireImages（真实资产读取，fail-soft）', () => {
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
    if (testDir) rmSync(testDir, { recursive: true, force: true });
  });

  it('图片资产 → data URL（含 mime 与 detail）', async () => {
    const asset = createAsset({
      name: 'a.png', mimeType: 'image/png', size: 8, kind: 'image', sha256: 'h',
    });
    await writeAssetFile(asset.id, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const out = await resolveWireImages([{ type: 'image', assetId: asset.id, detail: 'low' }]);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe(`data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}`);
    expect(out[0].detail).toBe('low');
  });

  it('资产不存在 → 跳过不抛错', async () => {
    const out = await resolveWireImages([mk('ghost')]);
    expect(out).toHaveLength(0);
  });

  it('非图片资产 → 跳过', async () => {
    const asset = createAsset({
      name: 'a.txt', mimeType: 'text/plain', size: 3, kind: 'text', sha256: 'h',
    });
    await writeAssetFile(asset.id, Buffer.from('abc'));
    const out = await resolveWireImages([mk(asset.id)]);
    expect(out).toHaveLength(0);
  });

  it('文件缺失（元数据在、字节不在）→ 跳过不抛错', async () => {
    const asset = createAsset({
      name: 'x.png', mimeType: 'image/png', size: 8, kind: 'image', sha256: 'h',
    });
    // 不写文件
    const out = await resolveWireImages([mk(asset.id)]);
    expect(out).toHaveLength(0);
  });
});

describe('hasImageParts', () => {
  it('undefined → false', () => {
    expect(hasImageParts(undefined)).toBe(false);
  });
  it('仅文本 → false；含图片 → true', () => {
    expect(hasImageParts([{ type: 'text', text: 'x' }])).toBe(false);
    expect(hasImageParts([{ type: 'text', text: 'x' }, mk('a')])).toBe(true);
  });
});
