/**
 * PluginStore API —— 服务端强制 scope 的插件 KV 存储（插件系统 T7，决策 A5/C3）。
 *
 * `pluginId` 由宿主在创建时通过闭包注入，返回的 store 对象上不暴露 id，
 * 插件代码无法读写其他插件的命名空间（C3：scope 由服务端强制，而非
 * 靠插件自觉传参）。持久化由 `repo/plugin-data.ts` 支撑——所有查询都
 * 带 `WHERE plugin_id = ?`，与闭包 scope 双重隔离。
 *
 * 值的序列化约定：`plugin_data.value` 列始终存 `JSON.stringify` 后的
 * 字符串。set 前序列化、get 后反序列化，调用方直接存取结构化值；
 * `undefined` 归一为 `null`（JSON 无 undefined 表示）。
 */
import type { PluginStore } from '@my-copilot/shared';
import { getData, setData, deleteData, listKeys } from '../repo/plugin-data.js';

/**
 * 为指定插件创建一个 PluginStore。pluginId 仅存在于闭包中，
 * 调用方拿到的 store 无法伪造或传入他人的 id。
 */
export function createPluginStore(pluginId: string): PluginStore {
  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      const value = getData(pluginId, key);
      if (value === undefined) return undefined;
      try {
        return JSON.parse(value) as T;
      } catch (err) {
        // 损坏数据不抛出：按"键不存在"处理并告警
        console.warn(
          `[plugin-store] 插件 "${pluginId}" 的键 "${key}" 存在无法解析的值，已按不存在处理：`,
          err,
        );
        return undefined;
      }
    },

    async set<T = unknown>(key: string, value: T): Promise<void> {
      setData(pluginId, key, JSON.stringify(value ?? null));
    },

    async delete(key: string): Promise<void> {
      deleteData(pluginId, key);
    },

    async list(): Promise<string[]> {
      return listKeys(pluginId);
    },
  };
}
