// McpsPage - MCP server connections list with create / edit / delete / test.
//
// Test button calls `api.testMcp(id)` which connects to the MCP server and
// lists its tools. The tool preview is shown inline in an expandable block.

import { useState, useEffect, useCallback } from 'react'
import type {
  Mcp,
  McpTransport,
  CreateMcpParams,
  UpdateMcpParams,
} from '@my-copilot/shared'
import { api } from '../../api'
import McpFormModal from '../../components/McpFormModal'
import { Badge } from '../../components/common/Badge'
import { showMessageAlert } from '../../components/common/Alert/alertUtils'

// ─── Transport badge ───

const transportColorClass: Record<McpTransport, string> = {
  stdio: 'bg-purple-100 text-purple-700',
  sse: 'bg-blue-100 text-blue-700',
  http: 'bg-emerald-100 text-emerald-700',
}

function TransportBadge({ transport }: { transport: McpTransport }) {
  return <Badge colorClass={transportColorClass[transport]}>{transport}</Badge>
}

// ─── Test result preview (per-row, expandable) ───

interface TestState {
  loading: boolean
  success: boolean
  toolNames: string[]
  error?: string
}

// The server returns `data: { success, tools }` where `tools` is a Tool[]
// (full objects) but the frontend API types it loosely as `{ tools: string[] }`.
// Be defensive: extract a displayable name from each entry regardless of shape.
function extractToolName(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if (typeof obj.name === 'string') return obj.name
  }
  return String(raw)
}

// ─── Page ───

export function McpsPage() {
  const [mcps, setMcps] = useState<Mcp[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingMcp, setEditingMcp] = useState<Mcp | null>(null)
  const [tests, setTests] = useState<Record<string, TestState>>({})

  const loadMcps = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await api.fetchMcps()
      setMcps(data)
    } catch (error) {
      console.error('Failed to load mcps:', error)
      showMessageAlert.error('加载 MCP 列表失败')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMcps()
  }, [loadMcps])

  const openCreate = () => {
    setEditingMcp(null)
    setIsModalOpen(true)
  }

  const openEdit = (mcp: Mcp) => {
    setEditingMcp(mcp)
    setIsModalOpen(true)
  }

  const handleDelete = async (mcp: Mcp) => {
    if (!confirm(`确定要删除 MCP「${mcp.name}」吗？此操作不可恢复。`)) return
    try {
      await api.deleteMcp(mcp.id)
      setMcps((prev) => prev.filter((m) => m.id !== mcp.id))
      showMessageAlert.success('MCP 已删除')
    } catch (error) {
      console.error('Failed to delete mcp:', error)
      showMessageAlert.error('删除 MCP 失败')
    }
  }

  const handleModalSave = async (
    params: CreateMcpParams | UpdateMcpParams,
  ) => {
    try {
      if (editingMcp) {
        const updated = await api.updateMcp(
          editingMcp.id,
          params as UpdateMcpParams,
        )
        setMcps((prev) =>
          prev.map((m) => (m.id === editingMcp.id ? updated : m)),
        )
        showMessageAlert.success('MCP 已更新')
      } else {
        const created = await api.createMcp(params as CreateMcpParams)
        setMcps((prev) => [...prev, created])
        showMessageAlert.success('MCP 创建成功')
      }
    } catch (error) {
      console.error('Failed to save mcp:', error)
      showMessageAlert.error('保存 MCP 失败')
    }
  }

  const handleTest = async (mcp: Mcp) => {
    setTests((prev) => ({
      ...prev,
      [mcp.id]: { loading: true, success: false, toolNames: [] },
    }))
    try {
      const result = await api.testMcp(mcp.id)
      // result may contain `success`, `error`, and `tools` (string[] or Tool[]).
      // The existing API typing is loose, so coerce defensively.
      const r = result as unknown as {
        success?: boolean
        error?: string
        tools?: unknown[]
      }
      const success = r.success !== false
      const toolNames = Array.isArray(r.tools)
        ? r.tools.map(extractToolName)
        : []
      setTests((prev) => ({
        ...prev,
        [mcp.id]: { loading: false, success, toolNames, error: r.error },
      }))
      if (success) {
        showMessageAlert.success(
          `连接成功，发现 ${toolNames.length} 个工具`,
        )
      } else {
        showMessageAlert.error(`连接失败：${r.error ?? '未知错误'}`)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '未知错误'
      setTests((prev) => ({
        ...prev,
        [mcp.id]: { loading: false, success: false, toolNames: [], error: msg },
      }))
      showMessageAlert.error(`测试失败：${msg}`)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-text-primary">MCP 管理</h2>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium"
        >
          + 新建 MCP
        </button>
      </div>

      {/* MCP list */}
      {isLoading ? (
        <div className="text-sm text-text-secondary">加载中...</div>
      ) : mcps.length === 0 ? (
        <div className="text-sm text-text-secondary">
          暂无 MCP，点击上方按钮创建
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {mcps.map((mcp) => {
            const test = tests[mcp.id]
            const hasPreview = test && !test.loading
            return (
              <div
                key={mcp.id}
                className="flex flex-col gap-2 p-4 bg-bg-secondary border border-border-base rounded-lg hover:border-primary-400 transition-colors"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-text-primary">
                        {mcp.name}
                      </span>
                      <TransportBadge transport={mcp.config.transport} />
                      <Badge
                        colorClass={
                          mcp.enabled
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                        }
                      >
                        {mcp.enabled ? '启用' : '禁用'}
                      </Badge>
                    </div>
                    <span className="text-xs text-text-secondary truncate">
                      {mcp.description || '—'}
                    </span>
                    <span className="text-xs text-text-tertiary font-mono truncate">
                      {mcp.config.transport === 'stdio'
                        ? `${mcp.config.command}${
                            mcp.config.args && mcp.config.args.length > 0
                              ? ' ' + mcp.config.args.join(' ')
                              : ''
                          }`
                        : mcp.config.url ?? ''}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleTest(mcp)}
                      disabled={test?.loading}
                      className="px-3 py-1.5 text-xs bg-bg-elevated border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {test?.loading ? '测试中...' : '测试'}
                    </button>
                    <button
                      onClick={() => openEdit(mcp)}
                      className="px-3 py-1.5 text-xs bg-bg-elevated border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(mcp)}
                      className="px-3 py-1.5 text-xs bg-error-50 border border-error-200 text-error-600 rounded-lg hover:bg-error-100 transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </div>

                {/* Test result preview */}
                {hasPreview && (
                  <div
                    className={`mt-1 px-3 py-2 rounded-lg text-xs border ${
                      test.success
                        ? 'bg-green-50 border-green-200 text-green-700'
                        : 'bg-error-50 border-error-200 text-error-600'
                    }`}
                  >
                    {test.success ? (
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">
                          连接成功 · {test.toolNames.length} 个工具
                        </span>
                        {test.toolNames.length > 0 && (
                          <span className="font-mono break-words">
                            {test.toolNames.join(', ')}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span>连接失败：{test.error}</span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <McpFormModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        mcp={editingMcp}
        onSave={handleModalSave}
      />
    </div>
  )
}
