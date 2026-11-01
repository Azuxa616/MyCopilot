// PluginInstallModal - 插件安装 Modal（目录 / 上传 ZIP 双模式），自 PluginsPage 抽出。
import { useState, useEffect } from 'react'
import { api } from '../api'
import Modal from './common/Modal'
import { FormField, formControlClassName } from './common/FormField'
import { showMessageAlert } from './common/Alert/alertUtils'

interface InstallModalProps {
  open: boolean
  onClose: () => void
  /** 安装成功回调（父组件负责关闭 Modal 并刷新列表）。 */
  onInstalled: () => void
}

type InstallMode = 'directory' | 'upload'

function PluginInstallModal({ open, onClose, onInstalled }: InstallModalProps) {
  const [mode, setMode] = useState<InstallMode>('upload')
  const [directory, setDirectory] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 每次打开时重置表单与错误状态。
  useEffect(() => {
    if (open) {
      setMode('upload')
      setDirectory('')
      setFile(null)
      setSubmitting(false)
      setError(null)
    }
  }, [open])

  const canSubmit = !submitting && (mode === 'directory' ? directory.trim().length > 0 : file !== null)

  const handleSubmit = async () => {
    if (submitting || !canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      if (mode === 'directory') {
        await api.installPlugin({ directory: directory.trim() })
      } else {
        await api.uploadPlugin(file!)
      }
      showMessageAlert.success('插件安装成功')
      onInstalled()
    } catch (err) {
      // server 返回的 msg 已含中文详情（zip_invalid / manifest_invalid / 409 等），
      // 直接在 Modal 内展示。
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
        {/* 模式切换 */}
        <div className="flex gap-1 p-1 bg-bg-tertiary rounded-lg text-sm">
          {(
            [
              { key: 'upload', label: '上传 ZIP' },
              { key: 'directory', label: '服务器目录' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setMode(tab.key)
                setError(null)
              }}
              className={`flex-1 px-3 py-1.5 rounded-md transition-colors ${
                mode === tab.key
                  ? 'bg-bg-elevated text-text-primary font-medium shadow-sm'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {mode === 'upload' ? (
          <FormField label="插件包（.zip）" required>
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setError(null)
              }}
              className="text-sm text-text-secondary file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-bg-elevated file:text-text-primary file:text-xs hover:file:bg-bg-hover"
            />
            <span className="text-xs text-text-tertiary">
              ZIP 内含 plugin.json（根目录或单一顶层目录），大小 ≤ 20MB
            </span>
          </FormField>
        ) : (
          <FormField label="目录名" required>
            <input
              type="text"
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              className={formControlClassName}
              placeholder="例如：my-plugin"
            />
            <span className="text-xs text-text-tertiary">
              输入服务器 PLUGINS_DIR 下已存在的子目录名
            </span>
          </FormField>
        )}

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

export default PluginInstallModal
