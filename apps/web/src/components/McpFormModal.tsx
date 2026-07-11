// McpFormModal - Create / edit an MCP server connection.
//
// Transport-aware form:
// - stdio: command (text) + args (textarea, newline-separated) + env (textarea, KEY=value lines)
// - sse / http: url (text)
//
// The args/env textareas are free-form on the UI side; we parse them into the
// structured `McpConfig` shape on submit. Server re-validates everything.

import { useState, useEffect } from 'react'
import type {
  Mcp,
  McpTransport,
  McpConfig,
  CreateMcpParams,
  UpdateMcpParams,
} from '@my-copilot/shared'
import Modal from './common/Modal'
import { FormField, formControlClassName } from './common/FormField'

export interface McpFormModalProps {
  open: boolean
  onClose: () => void
  /** When set, the modal edits this MCP; otherwise it creates a new one. */
  mcp?: Mcp | null
  onSave: (params: CreateMcpParams | UpdateMcpParams) => void
}

const TRANSPORTS: McpTransport[] = ['stdio', 'sse', 'http']

// ─── textarea <-> structured helpers ───

function argsToText(args?: string[]): string {
  return args && args.length > 0 ? args.join('\n') : ''
}

function textToArgs(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

function envToText(env?: Record<string, string>): string {
  if (!env) return ''
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

function textToEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue // skip lines without KEY= or with empty key
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1)
    if (key) env[key] = value
  }
  return env
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
  const [transport, setTransport] = useState<McpTransport>('stdio')
  const [enabled, setEnabled] = useState(true)

  // stdio fields
  const [command, setCommand] = useState('')
  const [argsText, setArgsText] = useState('')
  const [envText, setEnvText] = useState('')

  // sse/http field
  const [url, setUrl] = useState('')

  const [errors, setErrors] = useState<Record<string, string>>({})

  // Reset / hydrate whenever the modal opens or the target mcp changes.
  useEffect(() => {
    if (!open) return
    if (mcp) {
      setName(mcp.name)
      setDescription(mcp.description)
      setTransport(mcp.config.transport)
      setEnabled(mcp.enabled)
      setCommand(mcp.config.command ?? '')
      setArgsText(argsToText(mcp.config.args))
      setEnvText(envToText(mcp.config.env))
      setUrl(mcp.config.url ?? '')
    } else {
      setName('')
      setDescription('')
      setTransport('stdio')
      setEnabled(true)
      setCommand('')
      setArgsText('')
      setEnvText('')
      setUrl('')
    }
    setErrors({})
  }, [open, mcp])

  const validate = (): boolean => {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = '名称不能为空'
    if (transport === 'stdio') {
      if (!command.trim()) next.command = 'stdio 传输需要 command'
    } else {
      if (!url.trim()) next.url = `${transport} 传输需要 url`
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const buildConfig = (): McpConfig => {
    if (transport === 'stdio') {
      const config: McpConfig = { transport, command: command.trim() }
      const args = textToArgs(argsText)
      if (args.length > 0) config.args = args
      const env = textToEnv(envText)
      if (Object.keys(env).length > 0) config.env = env
      return config
    }
    return { transport, url: url.trim() }
  }

  const handleSubmit = () => {
    if (!validate()) return
    const config = buildConfig()
    if (isEdit && mcp) {
      const params: UpdateMcpParams = {
        name: name.trim(),
        description: description.trim(),
        config,
        enabled,
      }
      onSave(params)
    } else {
      const params: CreateMcpParams = {
        name: name.trim(),
        description: description.trim(),
        config,
        enabled,
      }
      onSave(params)
    }
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
        <FormField label="名称" required error={errors.name}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={formControlClassName}
            placeholder="例如：filesystem"
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

        {/* Transport */}
        <FormField label="传输方式" required>
          <select
            value={transport}
            onChange={(e) => setTransport(e.target.value as McpTransport)}
            className={formControlClassName}
            disabled={isEdit}
          >
            {TRANSPORTS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {isEdit && (
            <span className="text-xs text-text-tertiary italic">
              编辑模式下传输方式不可更改
            </span>
          )}
        </FormField>

        {/* Dynamic transport-specific fields */}
        {transport === 'stdio' ? (
          <>
            <FormField label="Command" required error={errors.command}>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                className={`${formControlClassName} font-mono text-xs`}
                placeholder="例如：npx"
              />
            </FormField>

            <FormField label="Args（每行一个）">
              <textarea
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                className={`${formControlClassName} min-h-[80px] resize-y font-mono text-xs`}
                placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/tmp'}
              />
            </FormField>

            <FormField label="Env（KEY=value 每行一个）">
              <textarea
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                className={`${formControlClassName} min-h-[80px] resize-y font-mono text-xs`}
                placeholder={'API_KEY=xxx\nNODE_ENV=production'}
              />
            </FormField>
          </>
        ) : (
          <FormField label="URL" required error={errors.url}>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className={`${formControlClassName} font-mono text-xs`}
              placeholder={
                transport === 'sse'
                  ? 'https://example.com/sse'
                  : 'https://example.com/mcp'
              }
            />
          </FormField>
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
        <div className="flex justify-end gap-3 mt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-primary bg-bg-secondary border border-border-base rounded-lg hover:bg-bg-hover transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors font-medium"
          >
            {isEdit ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
