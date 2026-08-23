// McpFormModal - Create / edit an MCP server connection via JSON config.
//
// 用户直接粘贴 McpConfig JSON（扁平格式，对应 @my-copilot/shared 的 McpConfig）。
// 前端用 validateConfigJson 做语法+结构实时校验作为保存门禁；"测试连通"
// 按钮调 POST /api/mcps/test-config 做不落库的临时连接测试。

import { useState, useMemo } from 'react'
import type {
  Mcp,
  CreateMcpParams,
  UpdateMcpParams,
} from '@my-copilot/shared'
import { api } from '../api'
import Modal from './common/Modal'
import { FormField, formControlClassName } from './common/FormField'
import { validateConfigJson } from '../utils/mcpConfig'

export interface McpFormModalProps {
  open: boolean
  onClose: () => void
  /** When set, the modal edits this MCP; otherwise it creates a new one. */
  mcp?: Mcp | null
  onSave: (params: CreateMcpParams | UpdateMcpParams) => void
}

const DEFAULT_CONFIG_TEXT = `{
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@playwright/mcp@latest"],
  "env": {}
}`

interface TestState {
  loading: boolean
  success?: boolean
  tools?: string[]
  error?: string
}

export default function McpFormModal({
  open,
  onClose,
  mcp,
  onSave,
}: McpFormModalProps) {
  const isEdit = Boolean(mcp)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [configText, setConfigText] = useState(DEFAULT_CONFIG_TEXT)
  const [enabled, setEnabled] = useState(true)
  const [test, setTest] = useState<TestState>({ loading: false })

  // Reset / hydrate whenever the modal opens or the target mcp changes.
  // 渲染期守卫式状态调整（react.dev "You Might Not Need an Effect"），
  // 哨兵 null 保证首帧即执行，与原 mount effect 行为一致。
  const [hydratedFor, setHydratedFor] = useState<{
    open: boolean
    mcp: Mcp | null | undefined
  } | null>(null)
  if (hydratedFor === null || hydratedFor.open !== open || hydratedFor.mcp !== mcp) {
    setHydratedFor({ open, mcp })
    if (open) {
      if (mcp) {
        setName(mcp.name)
        setDescription(mcp.description)
        setConfigText(JSON.stringify(mcp.config, null, 2))
        setEnabled(mcp.enabled)
      } else {
        setName('')
        setDescription('')
        setConfigText(DEFAULT_CONFIG_TEXT)
        setEnabled(true)
      }
      setTest({ loading: false })
    }
  }

  // 实时校验（每次 configText 变化都重新计算；validateConfigJson 是纯函数且很轻）。
  const validation = useMemo(() => validateConfigJson(configText), [configText])

  const canSave = name.trim().length > 0 && validation.config !== null

  const handleTest = async () => {
    if (!validation.config) return
    setTest({ loading: true })
    try {
      const result = await api.testMcpConfig(validation.config)
      setTest({
        loading: false,
        success: result.success,
        tools: result.tools,
        error: result.error,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '请求失败'
      setTest({ loading: false, success: false, error: msg })
    }
  }

  const handleSubmit = () => {
    if (!validation.config) return
    const params: CreateMcpParams | UpdateMcpParams = {
      name: name.trim(),
      description: description.trim(),
      config: validation.config,
      enabled,
    }
    onSave(params)
    onClose()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={isEdit ? '编辑 MCP' : '新建 MCP'}
      width="640px"
    >
      <div className="flex flex-col gap-4">
        {/* Name */}
        <FormField label="名称" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={formControlClassName}
            placeholder="例如：playwright"
          />
        </FormField>

        {/* Description */}
        <FormField label="描述">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`${formControlClassName} min-h-[60px] resize-y`}
            placeholder="MCP 用途描述（可选）"
          />
        </FormField>

        {/* Config JSON */}
        <FormField label="配置 JSON" required error={validation.error ?? undefined}>
          <textarea
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            className={`${formControlClassName} min-h-[200px] resize-y font-mono text-xs ${
              validation.error
                ? 'border-error focus:border-error'
                : validation.config
                  ? 'border-success focus:border-success'
                  : ''
            }`}
            placeholder={DEFAULT_CONFIG_TEXT}
            spellCheck={false}
          />
          {validation.preview && !validation.error && (
            <span className="text-xs text-success-dark font-mono break-words">
              {validation.preview}
            </span>
          )}
        </FormField>

        {/* Test connectivity result */}
        {test.success !== undefined && !test.loading && (
          <div
            className={`px-3 py-2 rounded-lg text-xs border ${
              test.success
                ? 'bg-success-light border-success text-success-dark'
                : 'bg-error-light border-error text-error-dark'
            }`}
          >
            {test.success ? (
              <div className="flex flex-col gap-1">
                <span className="font-medium">
                  连接成功 · {test.tools?.length ?? 0} 个工具
                </span>
                {test.tools && test.tools.length > 0 && (
                  <span className="font-mono break-words">
                    {test.tools.join(', ')}
                  </span>
                )}
              </div>
            ) : (
              <span>连接失败：{test.error}</span>
            )}
          </div>
        )}

        {/* Enabled toggle */}
        <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-4 h-4"
          />
          <span>启用此 MCP</span>
        </label>

        {/* Actions */}
        <div className="flex justify-between gap-3 mt-2">
          <button
            onClick={handleTest}
            disabled={!validation.config || test.loading}
            className="px-4 py-2 text-sm text-text-primary bg-bg-secondary border border-border-base rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {test.loading ? '测试中...' : '测试连通'}
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-text-primary bg-bg-secondary border border-border-base rounded-lg hover:bg-bg-hover transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSave}
              className="px-4 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isEdit ? '保存' : '创建'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}