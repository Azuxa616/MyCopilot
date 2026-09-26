/**
 * MCP 能力桥（插件系统 T5）：manifest.provides.mcpServers → mcps 表。
 *
 * register：为每个声明的 MCP 服务写入一行 mcps，id 采用确定性命名空间
 * 形式 `${pluginId}:${serverId}`，source_plugin_id 指回插件。transport 非
 * 'stdio'（清单 schema 保留 'http'）时抛中文错误——显式失败（C1），经
 * installFromDirectory 的事务回滚整个安装。
 *
 * unregister：删除该插件贡献的全部 mcps 行，并对每个 id 发起 best-effort
 * 断连（disconnect 异步，fire-and-forget，失败忽略——连接本可能不存在）。
 *
 * enabled 语义：register 在 install 链（调用时 state='verified'）与
 * enable 链（state='installed'/'disabled'）都会被调用。MCP 行的 enabled
 * 跟随插件是否正被启用：install 链写 false（插件尚未启用），enable 链
 * 写 true（行已存在时更新为 true）。
 */
import type { PluginCapabilities } from './capabilities.js';
import { PluginLifecycleError } from './loader.js';
import { isAbsolute, resolve } from 'node:path';
import {
  createMcp,
  deleteMcpsByPlugin,
  getMcp,
  listMcpsByPlugin,
  updateMcp,
} from '../repo/mcp.js';
import { deleteToolsByMcp } from '../repo/tool.js';
import { disconnect } from '../mcp/manager.js';

export const mcpCapabilities: PluginCapabilities = {
  register(plugin, pluginDir) {
    const servers = plugin.manifest.provides.mcpServers;
    if (!servers) return;

    // install 链上 register 时 state 尚为 'verified'（未置 installed）；
    // enable 链上为 'installed'/'disabled'。以此区分两条链。
    const willEnable = plugin.state !== 'verified';

    for (const serverDef of servers) {
      if (serverDef.transport !== 'stdio') {
        throw new PluginLifecycleError(
          'mcp_transport_unsupported',
          `插件 ${plugin.id} 的 MCP 服务 "${serverDef.id}" 使用不支持的 transport "${serverDef.transport}"（当前仅支持 stdio）`,
        );
      }

      const id = `${plugin.id}:${serverDef.id}`;
      // 幂等防御（重复 install 不会发生，但 enable 链会遇到 install 链已写的行）：
      // enable 链刷新为启用，install 链跳过。
      if (getMcp(id)) {
        if (willEnable) updateMcp(id, { enabled: true });
        continue;
      }

      createMcp({
        id,
        name: id,
        description: `${plugin.id} ${serverDef.id} MCP 服务（由插件提供）`,
        config: {
          transport: 'stdio',
          command: serverDef.command,
          // 可移植包约定：以 "./" 开头的 args 视为插件目录内的相对路径，注册时
          // 解析为绝对路径（同一 ZIP 在 Windows dev 与 Docker 均可用）；其余 args
          // （flag、绝对路径等）原样保留。
          args: serverDef.args?.map((arg) =>
            arg.startsWith('./') ? resolve(pluginDir, arg) : arg,
          ),
        },
        enabled: willEnable,
        sourcePluginId: plugin.id,
      });
    }
  },

  unregister(pluginId) {
    const owned = listMcpsByPlugin(pluginId);
    // 先清理每个 MCP 同步进 tools 表的行（mcp-provided），再删 mcps 行——
    // 否则禁用插件后残留启用的孤儿工具（executor 解析不到 MCP 配置）。
    for (const mcp of owned) {
      deleteToolsByMcp(mcp.id);
    }
    deleteMcpsByPlugin(pluginId);
    for (const mcp of owned) {
      void disconnect(mcp.id).catch(() => undefined);
    }
  },
};
