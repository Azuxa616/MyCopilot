// Tools are registered by application code or synchronized from MCP servers.

import { useState, useEffect, useCallback } from 'react'
import type { Tool, SafetyLevel, UpdateToolParams } from '@my-copilot/shared'
import { api } from '../../api'
import ToolFormModal from '../../components/ToolFormModal'
import ToolTestModal from '../../components/ToolTestModal'
import { Badge } from '../../components/common/Badge'
import { showMessageAlert } from '../../components/common/Alert/alertUtils'

// ─── Badge helpers ───

const toolTypeColorClass: Record<Tool['type'], string> = {
  'built-in': 'bg-gray-100 text-gray-600',
  'mcp-provided': 'bg-violet-100 text-violet-700',
}

function ToolTypeBadge({ type }: { type: Tool['type'] }) {
  return (
    <Badge colorClass={toolTypeColorClass[type]}>
      {type === 'built-in' ? 'Built-in' : 'MCP'}
    </Badge>
  )
}

const safetyLevelColorClass: Record<SafetyLevel, string> = {
  safe: 'bg-green-100 text-green-700',
  restricted: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
}

const safetyLevelLabel: Record<SafetyLevel, string> = {
  safe: '安全',
  restricted: '受限',
  danger: '危险',
}

function SafetyLevelBadge({ level }: { level: SafetyLevel }) {
  return (
    <Badge colorClass={safetyLevelColorClass[level]}>
      {safetyLevelLabel[level]}
    </Badge>
  )
}

// ─── Enabled toggle ───

function EnabledToggle({
  enabled,
  disabled,
  onToggle,
}: {
  enabled: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        enabled ? 'bg-primary-500' : 'bg-border-base'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

// ─── Page ───

export function ToolsPage() {
  const [tools, setTools] = useState<Tool[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editTool, setEditTool] = useState<Tool | undefined>()
  const [isTestModalOpen, setIsTestModalOpen] = useState(false)
  const [testTarget, setTestTarget] = useState<Tool | null>(null)
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())

  const loadTools = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await api.fetchTools()
      setTools(data)
    } catch (error) {
      console.error('Failed to load tools:', error)
      showMessageAlert.error('加载 Tools 失败')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTools()
  }, [loadTools])

  const handleEdit = (tool: Tool) => {
    setEditTool(tool)
    setIsModalOpen(true)
  }

  const handleOpenTest = (tool: Tool) => {
    setTestTarget(tool)
    setIsTestModalOpen(true)
  }

  const handleToggleEnabled = async (tool: Tool) => {
    setTogglingIds((prev) => new Set(prev).add(tool.id))
    try {
      const updated = await api.updateTool(tool.id, { enabled: !tool.enabled })
      setTools((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    } catch (error) {
      console.error('Failed to toggle tool enabled:', error)
      showMessageAlert.error('切换状态失败')
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev)
        next.delete(tool.id)
        return next
      })
    }
  }

  const handleModalSubmit = async (params: UpdateToolParams) => {
    try {
      if (editTool) {
        const updated = await api.updateTool(editTool.id, params)
        setTools((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
        showMessageAlert.success('工具安全策略已更新')
      }
    } catch (error) {
      console.error('Failed to save tool:', error)
      showMessageAlert.error('保存 Tool 失败')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-text-primary">工具管理</h2>
          <p className="mt-1 text-xs text-text-secondary">
            内置工具由应用代码注册；MCP 工具会在连接或测试时自动同步。
          </p>
        </div>
        <a
          href="/settings/mcps"
          className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100"
        >
          管理 MCP 来源
        </a>
      </div>

      {/* Tool list */}
      {isLoading ? (
        <div className="text-sm text-text-secondary">加载中...</div>
      ) : tools.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-base px-6 py-10 text-center">
          <p className="text-sm text-text-secondary">尚未注册或同步任何工具</p>
          <p className="mt-1 text-xs text-text-tertiary">添加 MCP Server 后，工具会自动出现在这里。</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {tools.map((tool) => {
            const isBuiltIn = tool.type === 'built-in'
            return (
              <div
                key={tool.id}
                className="flex items-center justify-between p-4 bg-bg-secondary border border-border-base rounded-lg hover:border-primary-400 transition-colors"
              >
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-text-primary">
                      {tool.name}
                    </span>
                    <ToolTypeBadge type={tool.type} />
                    <SafetyLevelBadge level={tool.safetyLevel} />
                    {isBuiltIn && (
                      <span className="text-xs text-text-tertiary italic">
                        （只读）
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-text-secondary truncate">
                    {tool.description || '—'}
                  </span>
                  <span className="text-xs text-text-tertiary">
                    {tool.inputSchema.fields.length} 个参数
                  </span>
                </div>

                <div className="flex items-center gap-3 shrink-0 pl-4">
                  <EnabledToggle
                    enabled={tool.enabled}
                    disabled={isBuiltIn || togglingIds.has(tool.id)}
                    onToggle={() => handleToggleEnabled(tool)}
                  />
                  <button
                    onClick={() => handleOpenTest(tool)}
                    className="px-3 py-1.5 text-xs bg-bg-primary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors"
                  >
                    测试
                  </button>
                  <button
                    onClick={() => handleEdit(tool)}
                    disabled={isBuiltIn}
                    className="px-3 py-1.5 text-xs bg-bg-primary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    编辑
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ToolFormModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        tool={editTool}
        onSubmit={handleModalSubmit}
      />

      <ToolTestModal
        open={isTestModalOpen}
        onOpenChange={setIsTestModalOpen}
        tool={testTarget}
      />
    </div>
  )
}
