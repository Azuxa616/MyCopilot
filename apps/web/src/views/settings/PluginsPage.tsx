// PluginsPage - 插件管理：安装 / 启用 / 禁用 / 卸载 PLUGINS_DIR 下的插件，并查看生命周期事件。
//
// 官方插件随宿主分发，只能启用 / 禁用，不提供卸载；社区插件来自用户目录，可卸载，
// 但启用需要子进程运行时支持（下轮实现），暂以禁用按钮占位。
// 所有状态变更成功后重新拉取列表；操作期间通过 busyIds 防连点。

import { useState, useEffect, useCallback } from 'react'
import type { PluginRecord, PluginSource } from '@my-copilot/shared'
import { api } from '../../api'
import { Badge } from '../../components/common/Badge'
import { showMessageAlert } from '../../components/common/Alert/alertUtils'
import PluginInstallModal from '../../components/PluginInstallModal'
import PluginEventsModal from '../../components/PluginEventsModal'
import { stateColorClass } from './plugin-status-colors'

// ─── Badge helpers ───

// 来源层级：official → 蓝系，community → 中性灰。
const sourceColorClass: Record<PluginSource, string> = {
  official: 'bg-blue-100 text-blue-700',
  community: 'bg-gray-100 text-gray-600',
}

const actionButtonClass =
  'px-3 py-1.5 text-xs bg-bg-elevated border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

const dangerButtonClass =
  'px-3 py-1.5 text-xs bg-error-50 border border-error-200 text-error-600 rounded-lg hover:bg-error-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

// ─── Page ───

export function PluginsPage() {
  const [plugins, setPlugins] = useState<PluginRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isInstallOpen, setIsInstallOpen] = useState(false)
  const [eventsTarget, setEventsTarget] = useState<PluginRecord | null>(null)
  // 操作进行中的插件 id 集合，防止连点。
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

  const loadPlugins = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await api.fetchPlugins()
      setPlugins(data)
    } catch (error) {
      console.error('Failed to load plugins:', error)
      showMessageAlert.error('加载插件列表失败')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPlugins()
  }, [loadPlugins])

  const runAction = async (
    id: string,
    action: () => Promise<unknown>,
    successMsg: string,
  ) => {
    setBusyIds((prev) => new Set(prev).add(id))
    try {
      await action()
      showMessageAlert.success(successMsg)
      await loadPlugins()
    } catch (err) {
      showMessageAlert.error(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const handleUninstall = (plugin: PluginRecord) => {
    if (
      !window.confirm(
        `确定要卸载插件「${plugin.id}」吗？关联数据将被清除。此操作不可恢复。`,
      )
    )
      return
    runAction(plugin.id, () => api.uninstallPlugin(plugin.id), '插件已卸载')
  }

  /**
   * community 插件启用前的信任确认（插件外部化 §5）：明示声明的权限与
   * MCP 命令——上传包本质是 admin 授权的代码执行，必须让用户看清在放行什么。
   */
  const handleEnable = (plugin: PluginRecord) => {
    if (plugin.source === 'community') {
      const perms = plugin.manifest.permissions ?? {}
      const permBits = [
        perms.network ? '网络访问' : null,
        perms.childProcess ? '子进程' : null,
        perms.filesystem ? '文件读写' : null,
      ].filter(Boolean)
      const mcpCommands = (plugin.manifest.provides.mcpServers ?? [])
        .map((s) => `${s.command} ${(s.args ?? []).join(' ')}`.trim())
      const summary = [
        `即将启用 community 插件「${plugin.id}」v${plugin.version}。`,
        permBits.length > 0 ? `\n声明权限：${permBits.join('、')}` : '\n未声明特殊权限。',
        mcpCommands.length > 0 ? `\n将运行的外部命令：\n${mcpCommands.map((c) => `  · ${c}`).join('\n')}` : '',
        '\n确认信任该插件吗？',
      ].join('')
      if (!window.confirm(summary)) return
    }
    runAction(plugin.id, () => api.enablePlugin(plugin.id), '插件已启用')
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-text-primary">插件管理</h2>
        <button
          onClick={() => setIsInstallOpen(true)}
          className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium"
        >
          安装插件
        </button>
      </div>

      {/* Plugin list */}
      {isLoading ? (
        <div className="text-sm text-text-secondary">加载中...</div>
      ) : plugins.length === 0 ? (
        <div className="text-sm text-text-secondary">
          暂无插件。点击「安装插件」上传 ZIP 包或导入 PLUGINS_DIR 下的插件目录。
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {plugins.map((plugin) => {
            const isBusy = busyIds.has(plugin.id)
            // 条件按钮矩阵：
            // - enabled → 「禁用」
            // - installed|disabled → 「启用」（community 暂不可用，禁用态占位）
            // - 非 official 且非 uninstalled → 「卸载」（confirm）
            // - uninstalled → 仅「事件」
            const canEnable =
              plugin.state === 'installed' || plugin.state === 'disabled'
            const canDisable = plugin.state === 'enabled'
            const canUninstall =
              plugin.source !== 'official' && plugin.state !== 'uninstalled'
            return (
              <div
                key={plugin.id}
                data-testid={`plugin-${plugin.id}`}
                className={`flex items-center justify-between p-4 bg-bg-secondary border border-border-base rounded-lg hover:border-primary-400 transition-colors ${
                  plugin.state === 'uninstalled' ? 'opacity-60' : ''
                }`}
              >
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-text-primary">
                      {plugin.id}
                    </span>
                    <span className="text-xs text-text-tertiary">
                      v{plugin.version}
                    </span>
                    <Badge colorClass={sourceColorClass[plugin.source]}>
                      {plugin.source}
                    </Badge>
                    <Badge colorClass={stateColorClass[plugin.state]}>
                      {plugin.state}
                    </Badge>
                    {plugin.type && (
                      <span className="text-xs text-text-tertiary">
                        {plugin.type}
                      </span>
                    )}
                  </div>
                  {plugin.digest && (
                    <span className="text-xs text-text-tertiary font-mono truncate">
                      {plugin.digest.slice(0, 8)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0 pl-4">
                  {canDisable && (
                    <button
                      onClick={() =>
                        runAction(
                          plugin.id,
                          () => api.disablePlugin(plugin.id),
                          '插件已禁用',
                        )
                      }
                      disabled={isBusy}
                      className={actionButtonClass}
                    >
                      禁用
                    </button>
                  )}
                  {canEnable && (
                    <button
                      onClick={() => handleEnable(plugin)}
                      disabled={isBusy}
                      className={actionButtonClass}
                    >
                      启用
                    </button>
                  )}
                  {canUninstall && (
                    <button
                      onClick={() => handleUninstall(plugin)}
                      disabled={isBusy}
                      className={dangerButtonClass}
                    >
                      卸载
                    </button>
                  )}
                  <button
                    onClick={() => setEventsTarget(plugin)}
                    disabled={isBusy}
                    className={actionButtonClass}
                  >
                    事件
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <PluginInstallModal
        open={isInstallOpen}
        onClose={() => setIsInstallOpen(false)}
        onInstalled={() => {
          setIsInstallOpen(false)
          loadPlugins()
        }}
      />

      <PluginEventsModal
        plugin={eventsTarget}
        onClose={() => setEventsTarget(null)}
      />
    </div>
  )
}
