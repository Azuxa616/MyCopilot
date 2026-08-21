/**
 * Plugin repository —— 插件注册表（插件系统 T3）。
 *
 * `plugins` 表每行对应一个已发现的插件，id = 清单 `name`（稳定 PluginId），
 * manifest 列保存安装时的完整 JSON 快照。状态机见 RFC
 * docs/rfc/plugin-manifest-lifecycle.md。
 *
 * 表结构见迁移 `0005_plugins.sql`（时间为 INTEGER 毫秒时间戳）。
 */
import type { PluginManifest, PluginSource, LifecycleState } from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { now } from './base.js';

export interface PluginRecord {
  id: string;
  version: string;
  source: PluginSource;
  state: LifecycleState;
  type?: string;
  manifest: PluginManifest;
  digest?: string;
  directory: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

interface PluginRow {
  id: string;
  version: string;
  source: string;
  state: string;
  type: string | null;
  manifest: string;
  digest: string | null;
  directory: string;
  error: string | null;
  created_at: number;
  updated_at: number;
}

function rowToPlugin(row: PluginRow): PluginRecord {
  return {
    id: row.id,
    version: row.version,
    source: row.source as PluginSource,
    state: row.state as LifecycleState,
    type: row.type ?? undefined,
    manifest: JSON.parse(row.manifest) as PluginManifest,
    digest: row.digest ?? undefined,
    directory: row.directory,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreatePluginParams {
  manifest: PluginManifest;
  state: LifecycleState;
  /** PLUGINS_DIR 下的子目录名。 */
  directory: string;
  digest?: string;
  error?: string;
}

/**
 * 注册一个插件。id/version/source/type 均取自清单（id = manifest.name）；
 * manifest 以 JSON 快照整串落库。同 id 重复插入会因主键约束抛错。
 */
export function createPlugin(params: CreatePluginParams): PluginRecord {
  const db = getDb();
  const { manifest } = params;
  const ts = now();

  db.prepare(
    `INSERT INTO plugins (id, version, source, state, type, manifest, digest, directory, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    manifest.name,
    manifest.version,
    manifest.source,
    params.state,
    manifest.type ?? null,
    JSON.stringify(manifest),
    params.digest ?? null,
    params.directory,
    params.error ?? null,
    ts,
    ts,
  );

  return getPlugin(manifest.name)!;
}

/** 列出全部插件，按创建时间倒序。 */
export function listPlugins(): PluginRecord[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM plugins ORDER BY created_at DESC')
    .all() as PluginRow[];
  return rows.map(rowToPlugin);
}

/** 按 id（清单 name）读取一个插件，不存在时返回 `undefined`。 */
export function getPlugin(id: string): PluginRecord | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as PluginRow | undefined;
  return row ? rowToPlugin(row) : undefined;
}

/** 只读状态列；插件不存在时返回 `undefined`。 */
export function getState(id: string): LifecycleState | undefined {
  const db = getDb();
  const row = db
    .prepare('SELECT state FROM plugins WHERE id = ?')
    .get(id) as { state: string } | undefined;
  return row ? (row.state as LifecycleState) : undefined;
}

/**
 * 更新插件状态并刷新 updated_at。`error` 显式覆盖（传 `undefined`/省略
 * 写 NULL，用于成功转换时清除上次失败原因）。插件不存在时返回
 * `undefined`。
 */
export function updatePluginState(
  id: string,
  state: LifecycleState,
  error?: string,
): PluginRecord | undefined {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM plugins WHERE id = ?')
    .get(id) as { id: string } | undefined;
  if (!existing) return undefined;

  db.prepare(
    `UPDATE plugins SET state = ?, error = ?, updated_at = ? WHERE id = ?`,
  ).run(state, error ?? null, now(), id);

  return getPlugin(id);
}

/** 删除一个插件注册行；返回是否确实删除了行。 */
export function deletePlugin(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM plugins WHERE id = ?').run(id);
  return result.changes > 0;
}
