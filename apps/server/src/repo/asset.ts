/**
 * Asset repository —— 附件资产层（docs/2026-09-30-attachment-assets-multimodal-design.md）。
 *
 * `assets` 表每行对应一个持久化附件资产；原始字节存文件系统
 * （DATA_DIR/attachments/<id>，见 attachment/storage.ts），DB 只存元数据。
 * 消息经 `messages.attachments[].assetId` 引用资产；图片资产同时以
 * `messages.parts` 的 image part 成为一等消息内容。
 */
import type { Asset, AssetKind, AssetSource } from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId, now } from './base.js';

interface AssetRow {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  kind: string;
  sha256: string;
  source: string;
  created_at: number;
  updated_at: number;
}

function rowToAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    kind: row.kind as AssetKind,
    sha256: row.sha256,
    source: row.source as AssetSource,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createAsset(params: {
  name: string;
  mimeType: string;
  size: number;
  kind: AssetKind;
  sha256: string;
  source?: AssetSource;
}): Asset {
  const db = getDb();
  const id = generateId();
  const ts = now();
  const source = params.source ?? 'upload';

  db.prepare(
    `INSERT INTO assets (id, name, mime_type, size, kind, sha256, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, params.name, params.mimeType, params.size, params.kind, params.sha256, source, ts, ts);

  return {
    id,
    name: params.name,
    mimeType: params.mimeType,
    size: params.size,
    kind: params.kind,
    sha256: params.sha256,
    source,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function getAsset(id: string): Asset | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined;
  return row ? rowToAsset(row) : undefined;
}

/** 最近资产列表（@file 引用与资产库的候选源，按创建时间倒序）。 */
export function listRecentAssets(limit = 50): Asset[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM assets ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(limit) as AssetRow[];
  return rows.map(rowToAsset);
}
