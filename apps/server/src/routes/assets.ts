/**
 * 资产路由（docs/2026-09-30-attachment-assets-multimodal-design.md）。
 *
 * 挂载于 `/api/assets`（见 index.ts）。上传即资产化：校验 → 落盘 →
 * 元数据入库。列表端点供 @file 引用选择器与资产库消费。
 */
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { createAsset, getAsset, listRecentAssets } from '../repo/asset.js';
import { writeAssetFile, readAssetFile } from '../attachment/storage.js';
import { detectKind } from '../attachment/kind.js';

export const assetsApp = new Hono();

function maxAttachmentBytes(): number {
  return (Number(process.env.MAX_ATTACHMENT_SIZE_MB) || 10) * 1024 * 1024;
}

/** 上传附件为资产：multipart 字段 file。 */
assetsApp.post('/', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ code: 400, msg: '缺少 file 字段', data: {} }, 400);
  }
  const maxBytes = maxAttachmentBytes();
  if (file.size > maxBytes) {
    return c.json(
      { code: 413, msg: `文件超过 ${maxBytes / 1024 / 1024} MB 上限`, data: {} },
      413,
    );
  }
  const data = Buffer.from(await file.arrayBuffer());
  const kind = detectKind(file.name, file.type, data);
  const asset = createAsset({
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: data.length,
    kind,
    sha256: createHash('sha256').update(data).digest('hex'),
  });
  await writeAssetFile(asset.id, data);
  return c.json({ code: 200, msg: 'ok', data: asset }, 201);
});

/** 资产列表（@file 引用选择器与资产库的候选源；name 为文件名子串过滤）。 */
assetsApp.get('/', (c) => {
  const name = c.req.query('name')?.trim().toLowerCase();
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
  const all = listRecentAssets(limit);
  const data = name ? all.filter((a) => a.name.toLowerCase().includes(name)) : all;
  return c.json({ code: 200, msg: 'ok', data });
});

/** 资产元数据。 */
assetsApp.get('/:id/meta', (c) => {
  const asset = getAsset(c.req.param('id'));
  if (!asset) return c.json({ code: 404, msg: '资产不存在', data: {} }, 404);
  return c.json({ code: 200, msg: 'ok', data: asset });
});

/** 原始字节流（图片/PDF 预览数据源；资产不可变 → immutable 缓存头）。 */
assetsApp.get('/:id/raw', async (c) => {
  const asset = getAsset(c.req.param('id'));
  if (!asset) return c.json({ code: 404, msg: '资产不存在', data: {} }, 404);
  try {
    const buf = await readAssetFile(asset.id);
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': asset.mimeType,
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch {
    return c.json({ code: 404, msg: '资产文件缺失', data: {} }, 404);
  }
});
