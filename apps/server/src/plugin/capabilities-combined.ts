/**
 * 插件能力聚合装配（插件系统 T5/T6 协作产物）。
 *
 * 将各子系统的 PluginCapabilities 桥聚合为一个实现，供宿主装配处调用
 * loader.setCapabilities() 注入。T5 将聚合 mcp 桥（capabilities-mcp.ts），
 * 落地后加入下方 combinedCapabilities 的聚合数组。
 *
 * 装配契约：本模块只导出常量/纯函数，绝不在模块顶层（或任何 import 链
 * 拉起的位置）调用 setCapabilities——模块副作用装配会破坏 T4 loader.test
 * 依赖的 noop 默认与测试隔离。实际装配点在 T9 的路由模块顶部显式执行：
 *
 *   import { setCapabilities } from '../plugin/loader.js';
 *   import { combinedCapabilities } from '../plugin/capabilities-combined.js';
 *   setCapabilities(combinedCapabilities);
 */
import type { PluginCapabilities } from './capabilities.js';
import { mcpCapabilities } from './capabilities-mcp.js';
import { skillCapabilities } from './capabilities-skills.js';

/** 顺序执行各桥的 register/unregister；任一桥抛错即中止并向外传播（install 事务回滚）。 */
export function combineCapabilities(
  ...caps: PluginCapabilities[]
): PluginCapabilities {
  return {
    register(plugin, pluginDir) {
      for (const cap of caps) cap.register(plugin, pluginDir);
    },
    unregister(pluginId) {
      for (const cap of caps) cap.unregister(pluginId);
    },
  };
}

/** 宿主装配用的聚合实现（T5 mcp 桥 + T6 skills 桥）。 */
export const combinedCapabilities: PluginCapabilities = combineCapabilities(
  mcpCapabilities,
  skillCapabilities,
);
