// ToolsPage - Tool list with CRUD + per-row test/enabled-toggle.
// Built-in tools (type === 'built-in') are read-only: edit/delete disabled, show a "Built-in" badge.

import { useState, useEffect, useCallback } from 'react'
import type { Tool, DangerLevel, CreateToolParams } from '@my-copilot/shared'
import { api } from '../../api'
import ToolFormModal from '../../components/ToolFormModal'
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

const dangerLevelColorClass: Record<DangerLevel, string> = {
  low: 'bg-green-100 text-green-700',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-red-100 text-red-700',
}

const dangerLevelLabel: Record<DangerLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
}

function DangerLevelBadge({ level }: { level: DangerLevel }) {
  return (
    <Badge colorClass={dangerLevelColorClass[level]}>
      {dangerLevelLabel[level]}
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
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set())
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; message: string } | null>
  >({})
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

  const handleCreate = () => {
    setEditTool(undefined)
    setModalMode('create')
    setIsModalOpen(true)
  }

  const handleEdit = (tool: Tool) => {
    setEditTool(tool)
    setModalMode('edit')
    setIsModalOpen(true)
  }

  const handleDelete = async (tool: Tool) => {
    if (!confirm(`确定要删除工具「${tool.name}」吗？此操作不可恢复。`)) return
    try {
      await api.deleteTool(tool.id)
      setTools((prev) => prev.filter((t) => t.id !== tool.id))
      showMessageAlert.success('Tool 已删除')
    } catch (error) {
      console.error('Failed to delete tool:', error)
      showMessageAlert.error('删除 Tool 失败')
    }
  }

  const handleTest = async (tool: Tool) => {
    setTestingIds((prev) => new Set(prev).add(tool.id))
    setTestResults((prev) => ({ ...prev, [tool.id]: null }))
    try {
      const result = await api.testTool(tool.id)
      const success = result.code === 0
      setTestResults((prev) => ({
        ...prev,
        [tool.id]: {
          success,
          message: success ? '测试成功' : `失败: ${result.msg}`,
        },
      }))
    } catch (error) {
      setTestResults((prev) => ({
        ...prev,
        [tool.id]: {
          success: false,
          message: `失败: ${error instanceof Error ? error.message : String(error)}`,
        },
      }))
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev)
        next.delete(tool.id)
        return next
      })
    }
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

  const handleModalSubmit = async (
    params: CreateToolParams | Partial<CreateToolParams>,
  ) => {
    try {
      if (modalMode === 'create') {
        const created = await api.createTool(params as CreateToolParams)
        setTools((prev) => [...prev, created])
        showMessageAlert.success('Tool 创建成功')
      } else if (editTool) {
        const updated = await api.updateTool(
          editTool.id,
          params as Partial<CreateToolParams>,
        )
        setTools((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
        showMessageAlert.success('Tool 更新成功')
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
        <h2 className="text-lg font-medium text-text-primary">工具管理</h2>
        <button
          onClick={handleCreate}
          className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium"
        >
          + 新建 Tool
        </button>
      </div>

      {/* Tool list */}
      {isLoading ? (
        <div className="text-sm text-text-secondary">加载中...</div>
      ) : tools.length === 0 ? (
        <div className="text-sm text-text-secondary">暂无 Tool，点击上方按钮创建</div>
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
                    <DangerLevelBadge level={tool.dangerLevel} />
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
                  {testResults[tool.id] && (
                    <span
                      className={`text-xs ${
                        testResults[tool.id]!.success
                          ? 'text-green-600'
                          : 'text-error-500'
                      }`}
                    >
                      {testResults[tool.id]!.message}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0 pl-4">
                  <EnabledToggle
                    enabled={tool.enabled}
                    disabled={isBuiltIn || togglingIds.has(tool.id)}
                    onToggle={() => handleToggleEnabled(tool)}
                  />
                  <button
                    onClick={() => handleTest(tool)}
                    disabled={testingIds.has(tool.id)}
                    className="px-3 py-1.5 text-xs bg-bg-primary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
                  >
                    {testingIds.has(tool.id) ? '测试中...' : '测试'}
                  </button>
                  <button
                    onClick={() => handleEdit(tool)}
                    disabled={isBuiltIn}
                    className="px-3 py-1.5 text-xs bg-bg-primary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(tool)}
                    disabled={isBuiltIn}
                    className="px-3 py-1.5 text-xs bg-error-50 border border-error-200 text-error-600 rounded-lg hover:bg-error-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    删除
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
        mode={modalMode}
        tool={editTool}
        onSubmit={handleModalSubmit}
      />
    </div>
  )
}
