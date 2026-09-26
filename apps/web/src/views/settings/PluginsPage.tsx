// PluginsPage - 插件管理：安装 / 启用 / 禁用 / 卸载 PLUGINS_DIR 下的插件，并查看生命周期事件。
//
// 官方插件随宿主分发，只能启用 / 禁用，不提供卸载；社区插件来自用户目录，可卸载，
// 但启用需要子进程运行时支持（下轮实现），暂以禁用按钮占位。
// 所有状态变更成功后重新拉取列表；操作期间通过 busyIds 防连点。

import { useState, useEffect, useCallback } from 'react'
import type {
  PluginRecord,
  PluginSource,
  LifecycleState,
  PluginLifecycleEvent,
} from '@my-copilot/shared'
import { api } from '../../api'
import Modal from '../../components/common/Modal'
import { FormField, formControlClassName } from '../../components/common/FormField'
import { Badge } from '../../components/common/Badge'
import { showMessageAlert } from '../../components/common/Alert/alertUtils'

// ─── Badge helpers ───

// 来源层级：official → 蓝系，community → 中性灰。
const sourceColorClass: Record<PluginSource, string> = {
  official: 'bg-blue-100 text-blue-700',
  community: 'bg-gray-100 text-gray-600',
}

// 七个生命周期状态：enabled 绿 / disabled 灰 / installed 蓝 /
// discovered·downloaded·verified 黄（过渡态）/ uninstalled 红（行整体 opacity-60）。
const stateColorClass: Record<LifecycleState, string> = {
  enabled: 'bg-green-100 text-green-700',
  disabled: 'bg-gray-100 text-gray-600',
  installed: 'bg-blue-100 text-blue-700',
  discovered: 'bg-amber-100 text-amber-700',
  downloaded: 'bg-amber-100 text-amber-700',
  verified: 'bg-amber-100 text-amber-700',
  uninstalled: 'bg-red-100 text-red-700',
}

const actionButtonClass =
  'px-3 py-1.5 text-xs bg-bg-elevated border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

const dangerButtonClass =
  'px-3 py-1.5 text-xs bg-error-50 border border-error-200 text-error-600 rounded-lg hover:bg-error-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

// ─── 安装 Modal ───

interface InstallModalProps {
  open: boolean
  onClose: () => void
  /** 安装成功回调（父组件负责关闭 Modal 并刷新列表）。 */
  onInstalled: () => void
}

function InstallModal({ open, onClose, onInstalled }: InstallModalProps) {
  const [directory, setDirectory] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 每次打开时重置表单与错误状态。
  useEffect(() => {
    if (open) {
      setDirectory('')
      setSubmitting(false)
      setError(null)
    }
  }, [open])

  const canSubmit = directory.trim().length > 0 && !submitting

  const handleSubmit = async () => {
    const dir = directory.trim()
    if (!dir || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await api.installPlugin({ directory: dir })
      showMessageAlert.success('插件安装成功')
      onInstalled()
    } catch (err) {
      // server 返回的 msg 已含中文详情，直接在 Modal 内展示。
      setError(err instanceof Error ? err.message : '安装失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="安装插件"
      width="480px"
    >
      <div className="flex flex-col gap-4">
        <FormField label="目录名" required>
          <input
            type="text"
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
            className={formControlClassName}
            placeholder="例如：my-plugin"
          />
          <span className="text-xs text-text-tertiary">
            输入 PLUGINS_DIR 下的子目录名
          </span>
        </FormField>

        {error && (
          <div className="px-3 py-2 rounded-lg text-xs border bg-error-50 border-error-200 text-error-600">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3 mt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-primary bg-bg-secondary border border-border-base rounded-lg hover:bg-bg-hover transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? '安装中...' : '安装'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── 事件 Modal ───

interface EventsModalProps {
  /** 当前查看事件的插件；null 时 Modal 关闭。 */
  plugin: PluginRecord | null
  onClose: () => void
}

function EventsModal({ plugin, onClose }: EventsModalProps) {
  const [events, setEvents] = useState<PluginLifecycleEvent[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedForId, setLoadedForId] = useState<string | null>(null)
  const targetId = plugin?.id ?? null

  // 切换目标插件时在渲染期重置派生状态（react-docs「render-time state
  // adjust」模式，替代 effect 内同步 setState，规避级联渲染）。
  if (targetId !== loadedForId) {
    setLoadedForId(targetId)
    setEvents([])
    setError(null)
    setIsLoading(targetId !== null)
  }

  useEffect(() => {
    if (!targetId) return
    let cancelled = false
    api
      .fetchPluginEvents(targetId)
      .then((data) => {
        if (!cancelled) {
          // 倒序展示（最新事件在前）。
          setEvents([...data].sort((a, b) => b.timestamp - a.timestamp))
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载事件失败')
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [targetId])

  return (
    <Modal
      open={plugin !== null}
      onOpenChange={(o) => !o && onClose()}
      title={`生命周期事件 · ${plugin?.id ?? ''}`}
      width="560px"
    >
      <div className="flex flex-col gap-2">
        {isLoading ? (
          <div className="text-sm text-text-secondary">加载中...</div>
        ) : error ? (
          <div className="px-3 py-2 rounded-lg text-xs border bg-error-50 border-error-200 text-error-600">
            {error}
          </div>
        ) : events.length === 0 ? (
          <div className="text-sm text-text-secondary">暂无事件记录</div>
        ) : (
          events.map((event) => (
            <div
              key={event.eventId}
              className="flex items-center gap-3 text-xs py-1 border-b border-border-base last:border-b-0"
            >
              <Badge colorClass={stateColorClass[event.toState]}>
                {event.toState}
              </Badge>
              <span className="text-text-secondary">{event.trigger}</span>
              <span
                className={
                  event.result.status === 'failed'
                    ? 'text-error-600 font-medium'
                    : 'text-text-tertiary'
                }
              >
                {event.result.status}
              </span>
            </div>
          ))
        )}
      </div>
    </Modal>
  )
}

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
          暂无插件。点击「安装插件」导入 PLUGINS_DIR 下的插件目录。
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
                      onClick={() =>
                        runAction(
                          plugin.id,
                          () => api.enablePlugin(plugin.id),
                          '插件已启用',
                        )
                      }
                      disabled={isBusy || plugin.source === 'community'}
                      title={
                        plugin.source === 'community'
                          ? '社区插件暂不可启用（需子进程运行时，下轮支持）'
                          : undefined
                      }
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

      <InstallModal
        open={isInstallOpen}
        onClose={() => setIsInstallOpen(false)}
        onInstalled={() => {
          setIsInstallOpen(false)
          loadPlugins()
        }}
      />

      <EventsModal
        plugin={eventsTarget}
        onClose={() => setEventsTarget(null)}
      />
    </div>
  )
}
