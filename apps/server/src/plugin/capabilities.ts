/**
 * 插件能力装配接口（插件系统 T4，解耦声明）。
 *
 * loader（生命周期状态机）只依赖本接口，不直接 import MCP/Skill 等注册
 * 逻辑——避免 plugin 模块与宿主各子系统之间的编译期耦合。T5/T6 实现
 * 真实桥接（MCP 注册、Skills 同步等）后，在装配处调用 loader 的
 * setCapabilities() 注入实现；在此之前 loader 使用 noopCapabilities。
 */
import type { PluginRecord } from '../repo/plugin.js';

/**
 * 插件进入/离开 installed 与 enabled 态时宿主需要执行的"能力装配"动作。
 *
 * 实现必须同步完成：installFromDirectory 在 better-sqlite3 事务内调用
 * register，任一实现抛错都会触发整个 install 事务回滚。
 */
export interface PluginCapabilities {
  /** 插件装配完成（installed/enabled）时注册其声明的资源（MCP、Skill、工具等）。 */
  register(plugin: PluginRecord, pluginDir: string): void;
  /** 插件离开 enabled 态时反注册其资源。 */
  unregister(pluginId: string): void;
}

/** 默认空实现：不做任何资源装配（T5/T6 装配前的占位）。 */
export const noopCapabilities: PluginCapabilities = {
  register() {},
  unregister() {},
};
