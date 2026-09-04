/**
 * Plugin data repository —— 插件私有 KV 存储（插件系统 T3，决策 A5）。
 *
 * `plugin_data` 表支撑 PluginStore API：每个 (pluginId, key) 一行，
 * value 为调用方序列化后的字符串。所有查询都按 `plugin_id` 强制加
 * scope，插件之间天然隔离（无 FK，行独立于 plugins 表存活）。
 *
 * 表结构见迁移 `0005_plugins.sql`（时间为 INTEGER 毫秒时间戳）。
 */
import { getDb } from '../db/index.js';
import { now } from './base.js';

interface PluginDataRow {
  plugin_id: string;
  key: string;
  value: string;
  created_at: number;
  updated_at: number;
}

/** 读取一个 key 的值；不存在或属于其他插件时返回 `undefined`。 */
export function getData(pluginId: string, key: string): string | undefined {
  const db = getDb();
  const row = db
    .prepare('SELECT value FROM plugin_data WHERE plugin_id = ? AND key = ?')
    .get(pluginId, key) as { value: string } | undefined;
  return row?.value;
}

/**
 * 写入一个 key。若同 (pluginId, key) 已存在则按 upsert 语义更新 value
 * 与 updated_at；createdAt 保持不变。
 */
export function setData(pluginId: string, key: string, value: string): void {
  const db = getDb();
  const ts = now();
  db.prepare(
    `INSERT INTO plugin_data (plugin_id, key, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(plugin_id, key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  ).run(pluginId, key, value, ts, ts);
}

/** 删除一个 key；返回是否确实删除了行。 */
export function deleteData(pluginId: string, key: string): boolean {
  const db = getDb();
  const result = db
    .prepare('DELETE FROM plugin_data WHERE plugin_id = ? AND key = ?')
    .run(pluginId, key);
  return result.changes > 0;
}

/** 清空某插件的全部数据（uninstall 用）；返回删除的行数。 */
export function deleteAllData(pluginId: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM plugin_data WHERE plugin_id = ?').run(pluginId);
  return result.changes;
}

/** 列出某插件拥有的全部 key，按 key 升序。 */
export function listKeys(pluginId: string): string[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT key FROM plugin_data WHERE plugin_id = ? ORDER BY key ASC')
    .all(pluginId) as Pick<PluginDataRow, 'key'>[];
  return rows.map((r) => r.key);
}
