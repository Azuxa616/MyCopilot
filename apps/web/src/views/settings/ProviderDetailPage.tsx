// ProviderDetailPage - Provider detail + Model CRUD

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Provider, Model } from '@my-copilot/shared'
import { api } from '../../api'
import ModelFormModal from '../../components/ModelFormModal'
import { ProviderTypeBadge, StatusBadge } from '../../components/common/Badge'
import { showMessageAlert } from '../../components/common/Alert/alertUtils'

export function ProviderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [provider, setProvider] = useState<Provider | null>(null)
  const [models, setModels] = useState<Model[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editModel, setEditModel] = useState<Model | undefined>()
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')

  const loadData = useCallback(async () => {
    if (!id) return
    setIsLoading(true)
    try {
      const [p, m] = await Promise.all([
        api.fetchProvider(id),
        api.fetchModelsByProvider(id),
      ])
      setProvider(p)
      setModels(m)
    } catch (error) {
      console.error('Failed to load provider detail:', error)
      showMessageAlert.error('加载 Provider 详情失败')
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleCreate = () => {
    setEditModel(undefined)
    setModalMode('create')
    setIsModalOpen(true)
  }

  const handleEdit = (model: Model) => {
    setEditModel(model)
    setModalMode('edit')
    setIsModalOpen(true)
  }

  const handleDelete = async (modelId: string) => {
    if (!confirm('此操作不可恢复；若 session 引用此 model，将被解绑。确定删除？')) return
    try {
      await api.deleteModel(modelId)
      setModels((prev) => prev.filter((m) => m.id !== modelId))
      showMessageAlert.success('模型已删除')
    } catch (error) {
      console.error('Failed to delete model:', error)
      showMessageAlert.error('删除模型失败')
    }
  }

  const handleModalSubmit = async (params: Parameters<typeof api.createModel>[1] | Partial<Parameters<typeof api.createModel>[1]>) => {
    if (!id) return
    try {
      if (modalMode === 'create') {
        const created = await api.createModel(id, params as Parameters<typeof api.createModel>[1])
        setModels((prev) => [...prev, created])
        showMessageAlert.success('模型创建成功')
      } else if (editModel) {
        const updated = await api.updateModel(editModel.id, params as Partial<Parameters<typeof api.createModel>[1]>)
        setModels((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
        showMessageAlert.success('模型更新成功')
      }
    } catch (error) {
      console.error('Failed to save model:', error)
      showMessageAlert.error('保存模型失败')
    }
  }

  if (isLoading) {
    return <div className="text-sm text-text-secondary">加载中...</div>
  }

  if (!provider) {
    return <div className="text-sm text-text-secondary">Provider 不存在或已删除</div>
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Provider info */}
      <div className="flex flex-col gap-4 p-4 bg-bg-secondary border border-border-base rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-text-primary">{provider.name}</h2>
            <ProviderTypeBadge type={provider.type} />
            <StatusBadge enabled={provider.enabled} />
          </div>
          <button
            onClick={() => navigate('/settings/providers')}
            className="text-sm text-primary-500 hover:text-primary-600 transition-colors"
          >
            ← 返回列表
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 text-sm">
          <div className="flex gap-2">
            <span className="text-text-secondary w-20">Base URL</span>
            <span className="text-text-primary font-mono">{provider.baseUrl}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-text-secondary w-20">API Key</span>
            <span className="text-text-primary">{provider.apiKey ? '已配置' : '未配置'}</span>
          </div>
        </div>
      </div>

      {/* Models section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium text-text-primary">模型列表</h3>
          <button
            onClick={handleCreate}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium"
          >
            + 新建模型
          </button>
        </div>

        {models.length === 0 ? (
          <div className="text-sm text-text-secondary">暂无模型，点击上方按钮创建</div>
        ) : (
          <div className="flex flex-col gap-2">
            {models.map((model) => (
              <div
                key={model.id}
                className="flex items-center justify-between p-3 bg-bg-secondary border border-border-base rounded-lg hover:border-primary-400 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-text-primary">{model.name}</span>
                  {model.displayName && (
                    <span className="text-xs text-text-secondary">({model.displayName})</span>
                  )}
                  <StatusBadge enabled={model.enabled} />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEdit(model)}
                    className="px-3 py-1.5 text-xs bg-bg-primary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(model.id)}
                    className="px-3 py-1.5 text-xs bg-error-50 border border-error-200 text-error-600 rounded-lg hover:bg-error-100 transition-colors"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ModelFormModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        mode={modalMode}
        model={editModel}
        onSubmit={handleModalSubmit}
      />
    </div>
  )
}
