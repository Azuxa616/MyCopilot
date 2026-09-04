/**
 * 命名空间冲突检测（插件系统 T7）。
 *
 * 挂点：T9 的 enable 路由，在执行 enable 转换**之前**调用——若本插件
 * 与其他已启用（state='enabled'）插件在 mcps/skills 表中产生了**同
 * 全限定名**的行，则拒绝启用。
 *
 * 当前 schema 下插件资源名带 `pluginId:` 前缀，不同插件在数学上不可能
 * 产生同全限定名（前缀即插件 id，见 shared PluginId 的约定）。本检测
 * 属防御性兜底：为未来可能出现的"无前缀"资源命名场景保留一道闸门。
 *
 * 本模块刻意不 import loader（T4 lane），避免与其循环依赖。
 */
import { getDb } from '../db/index.js';

/** 命名空间冲突的稳定错误码，T9 enable 路由引用它做错误映射。 */
export const NAMESPACE_CONFLICT = 'namespace_conflict';

/**
 * 找出 pluginId 在 `table`（'mcps' | 'skills'）中与其他 enabled 插件
 * 同名（全限定名，即 name 列）的资源行，返回冲突的名字列表。
 */
function findConflicts(pluginId: string, table: 'mcps' | 'skills'): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT m1.name AS name
       FROM ${table} m1
       JOIN ${table} m2 ON m1.name = m2.name
       WHERE m1.source_plugin_id = ?
         AND m2.source_plugin_id != ?
         AND m2.source_plugin_id IN (SELECT id FROM plugins WHERE state = 'enabled')`,
    )
    .all(pluginId, pluginId) as { name: string }[];
  return rows.map((r) => r.name);
}

/**
 * 断言启用 `pluginId` 不会与其他已启用插件产生命名空间冲突。
 * 冲突时抛出 Error，message 含稳定错误码 `namespace_conflict`
 * 与全部冲突资源名。
 */
export function assertNoNamespaceConflict(pluginId: string): void {
  const conflicts = [
    ...findConflicts(pluginId, 'mcps').map((name) => `mcp:${name}`),
    ...findConflicts(pluginId, 'skills').map((name) => `skill:${name}`),
  ];
  if (conflicts.length > 0) {
    throw new Error(
      `[${NAMESPACE_CONFLICT}] 启用插件 "${pluginId}" 会与其他已启用插件冲突，同名资源：${conflicts.join(', ')}`,
    );
  }
}
