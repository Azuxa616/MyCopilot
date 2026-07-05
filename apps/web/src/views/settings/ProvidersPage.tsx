// ProvidersPage - Provider list with CRUD + Auth Token config

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Provider } from '@my-copilot/shared'
import { api } from '../../api'
import ProviderFormModal from '../../components/ProviderFormModal'
import { ProviderTypeBadge, StatusBadge } from '../../components/common/Badge'
import { showMessageAlert } from '../../components/common/Alert/alertUtils'
import { useConfigStore } from '../../store/configStore'

export function ProvidersPage() {
  const navigate = useNavigate()
  const [providers, setProviders] = useState<Provider[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editProvider, setEditProvider] = useState<Provider | undefined>()
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string } | null>>({})
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set())

  // Auth token state — sync from store on mount
  const authToken = useConfigStore((state) => state.authToken)
  const submitAuthToken = useConfigStore((state) => state.submitAuthToken)
  const clearAuthToken = useConfigStore((state) => state.clearAuthToken)
  const [tokenInput, setTokenInput] = useState('')

  useEffect(() => {
    if (authToken) setTokenInput(authToken)
  }, [authToken])

  const loadProviders = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await api.fetchProviders()
      setProviders(data)
    } catch (error) {
      console.error('Failed to load providers:', error)
      showMessageAlert.error('加载 Providers 失败')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  const handleCreate = () => {
    setEditProvider(undefined)
    setModalMode('create')
    setIsModalOpen(true)
  }

  const handleEdit = (provider: Provider) => {
    setEditProvider(provider)
    setModalMode('edit')
    setIsModalOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除此 Provider 吗？此操作不可恢复。')) return
    try {
      await api.deleteProvider(id)
      setProviders((prev) => prev.filter((p) => p.id !== id))
      showMessageAlert.success('Provider 已删除')
    } catch (error) {
      console.error('Failed to delete provider:', error)
      showMessageAlert.error('删除 Provider 失败')
    }
  }

  const handleTest = async (provider: Provider) => {
    setTestingIds((prev) => new Set(prev).add(provider.id))
    setTestResults((prev) => ({ ...prev, [provider.id]: null }))
    try {
      const result = await api.testProvider(provider.id)
      if (result.success) {
        setTestResults((prev) => ({
          ...prev,
          [provider.id]: { success: true, message: `可达, 延迟 ${result.latencyMs}ms` },
        }))
      } else {
        setTestResults((prev) => ({
          ...prev,
          [provider.id]: { success: false, message: `失败: ${result.errorClass || ''} - ${result.message || ''}` },
        }))
      }
    } catch (error) {
      setTestResults((prev) => ({
        ...prev,
        [provider.id]: { success: false, message: `失败: ${error instanceof Error ? error.message : String(error)}` },
      }))
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev)
        next.delete(provider.id)
        return next
      })
    }
  }

  const handleModalSubmit = async (params: Parameters<typeof api.createProvider>[0] | Partial<Parameters<typeof api.createProvider>[0]>) => {
    try {
      if (modalMode === 'create') {
        const created = await api.createProvider(params as Parameters<typeof api.createProvider>[0])
        setProviders((prev) => [...prev, created])
        showMessageAlert.success('Provider 创建成功')
      } else if (editProvider) {
        const updated = await api.updateProvider(editProvider.id, params as Partial<Parameters<typeof api.createProvider>[0]>)
        setProviders((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
        showMessageAlert.success('Provider 更新成功')
      }
    } catch (error) {
      console.error('Failed to save provider:', error)
      showMessageAlert.error('保存 Provider 失败')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Auth Token config */}
      <div className="p-4 bg-bg-secondary border border-border-base rounded-lg">
        <h2 className="text-lg font-medium text-text-primary mb-3">Auth Token</h2>
        <p className="text-xs text-text-secondary mb-3">从 server 启动日志获取 AUTH_TOKEN，粘贴到下方</p>
        <div className="flex gap-2">
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            className="flex-1 px-3 py-2 text-sm text-text-primary bg-bg-elevated border border-border-base rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all placeholder:text-text-tertiary font-mono"
            placeholder="Enter AUTH_TOKEN"
          />
          <button
            onClick={() => {
              const trimmed = tokenInput.trim()
              if (trimmed) {
                submitAuthToken(trimmed)
                showMessageAlert.success('Token 已保存')
              }
            }}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium disabled:opacity-50"
          >
            保存
          </button>
          {authToken && (
            <button
              onClick={() => {
                clearAuthToken()
                setTokenInput('')
                showMessageAlert.success('Token 已清除')
              }}
              className="px-4 py-2 bg-bg-primary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors text-sm"
            >
              清除
            </button>
          )}
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-text-primary">模型提供商</h2>
        <button
          onClick={handleCreate}
          className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium"
        >
          + 新建 Provider
        </button>
      </div>

      {/* Provider list */}
      {isLoading ? (
        <div className="text-sm text-text-secondary">加载中...</div>
      ) : providers.length === 0 ? (
        <div className="text-sm text-text-secondary">暂无 Provider，点击上方按钮创建</div>
      ) : (
        <div className="flex flex-col gap-3">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center justify-between p-4 bg-bg-secondary border border-border-base rounded-lg hover:border-primary-400 transition-colors"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{provider.name}</span>
                  <ProviderTypeBadge type={provider.type} />
                  <StatusBadge enabled={provider.enabled} />
                </div>
                <span className="text-xs text-text-secondary">{provider.baseUrl}</span>
                {testResults[provider.id] && (
                  <span
                    className={`text-xs ${
                      testResults[provider.id]!.success ? 'text-green-600' : 'text-error-500'
                    }`}
                  >
                    {testResults[provider.id]!.message}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleTest(provider)}
                  disabled={testingIds.has(provider.id)}
                  className="px-3 py-1.5 text-xs bg-bg-primary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
                >
                  {testingIds.has(provider.id) ? '测试中...' : '测试连通'}
                </button>
                <button
                  onClick={() => navigate(`/settings/providers/${provider.id}`)}
                  className="px-3 py-1.5 text-xs bg-bg-primary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors"
                >
                  管理模型
                </button>
                <button
                  onClick={() => handleEdit(provider)}
                  className="px-3 py-1.5 text-xs bg-bg-primary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors"
                >
                  编辑
                </button>
                <button
                  onClick={() => handleDelete(provider.id)}
                  className="px-3 py-1.5 text-xs bg-error-50 border border-error-200 text-error-600 rounded-lg hover:bg-error-100 transition-colors"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ProviderFormModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        mode={modalMode}
        provider={editProvider}
        onSubmit={handleModalSubmit}
      />
    </div>
  )
}
