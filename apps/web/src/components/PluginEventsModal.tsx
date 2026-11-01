// PluginEventsModal - 插件生命周期事件查看 Modal，自 PluginsPage 抽出。
import { useState, useEffect } from 'react'
import type { PluginRecord, PluginLifecycleEvent } from '@my-copilot/shared'
import { api } from '../api'
import Modal from './common/Modal'
import { Badge } from './common/Badge'
import { stateColorClass } from '../views/settings/plugin-status-colors'

interface EventsModalProps {
  /** 当前查看事件的插件；null 时 Modal 关闭。 */
  plugin: PluginRecord | null
  onClose: () => void
}

function PluginEventsModal({ plugin, onClose }: EventsModalProps) {
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

export default PluginEventsModal
