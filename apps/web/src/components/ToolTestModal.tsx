// ToolTestModal - Schema-driven tool execution panel for manual testing.
// Renders input fields based on the tool's inputSchema, calls the real
// /api/tools/:id/test endpoint, and displays full output + isError + status.

import { useState, useMemo } from 'react'
import type { Tool, ToolInputSchemaField } from '@my-copilot/shared'
import Modal from './common/Modal'
import { FormField, formControlClassName } from './common/FormField'
import { Badge } from './common/Badge'
import { api } from '../api'

export interface ToolTestModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tool: Tool | null
}

interface TestResult {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

type ExecState = 'idle' | 'running' | 'done' | 'error'

const safetyLevelLabel: Record<string, string> = {
  safe: '安全',
  restricted: '受限',
  danger: '危险',
}

const safetyLevelColor: Record<string, string> = {
  safe: 'bg-green-100 text-green-700',
  restricted: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
}

/** Parse a raw string value into the target type for the API call. */
function parseValue(raw: string, type: ToolInputSchemaField['type']): unknown {
  if (type === 'boolean') return raw === 'true'
  if (type === 'number') {
    const n = Number(raw)
    return Number.isNaN(n) ? raw : n
  }
  if (type === 'object' || type === 'array') {
    try {
      return JSON.parse(raw)
    } catch {
      return raw // let the tool handle the invalid JSON
    }
  }
  return raw
}

export default function ToolTestModal({ open, onOpenChange, tool }: ToolTestModalProps) {
  const [argValues, setArgValues] = useState<Record<string, string>>({})
  const [execState, setExecState] = useState<ExecState>('idle')
  const [result, setResult] = useState<TestResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  // Reset state when a different tool is opened
  const toolId = tool?.id ?? ''
  const [lastToolId, setLastToolId] = useState('')
  if (open && toolId !== lastToolId) {
    setLastToolId(toolId)
    setArgValues({})
    setExecState('idle')
    setResult(null)
    setErrorMsg('')
  }

  const fields = useMemo(() => tool?.inputSchema.fields ?? [], [tool])

  const handleExecute = async () => {
    if (!tool) return
    setExecState('running')
    setResult(null)
    setErrorMsg('')

    // Build arguments object from form values
    const args: Record<string, unknown> = {}
    for (const field of fields) {
      const raw = argValues[field.name]
      if (raw === undefined || raw === '') {
        if (field.required) {
          setErrorMsg(`参数 "${field.name}" 是必填项`)
          setExecState('error')
          return
        }
        continue
      }
      args[field.name] = parseValue(raw, field.type)
    }

    try {
      const res = await api.testTool(tool.id, args)
      setResult(res)
      setExecState(res.isError ? 'error' : 'done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setExecState('error')
    }
  }

  const isSafe = tool?.safetyLevel === 'safe'

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`测试工具: ${tool?.name ?? ''}`}
      width="600px"
    >
      {tool && (
        <div className="flex flex-col gap-4">
          {/* Tool info */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge colorClass={safetyLevelColor[tool.safetyLevel] ?? 'bg-gray-100 text-gray-600'}>
              {safetyLevelLabel[tool.safetyLevel] ?? tool.safetyLevel}
            </Badge>
            <span className="text-xs text-text-tertiary">
              {tool.inputSchema.fields.length} 个参数
            </span>
            {!isSafe && (
              <span className="text-xs text-amber-600">
                此工具需要确认，测试入口仅支持 safe 级别直接执行
              </span>
            )}
          </div>

          {/* Description */}
          {tool.description && (
            <p className="text-sm text-text-secondary">{tool.description}</p>
          )}

          {/* Parameter form */}
          {fields.length > 0 ? (
            <div className="flex flex-col gap-3">
              <label className="text-xs font-medium text-text-secondary">参数</label>
              {fields.map((field) => (
                <FormField
                  key={field.name}
                  label={field.name}
                  required={field.required}
                >
                  {field.type === 'boolean' ? (
                    <select
                      value={argValues[field.name] ?? 'false'}
                      onChange={(e) =>
                        setArgValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                      }
                      className={formControlClassName}
                    >
                      <option value="false">false</option>
                      <option value="true">true</option>
                    </select>
                  ) : field.type === 'object' || field.type === 'array' ? (
                    <textarea
                      value={argValues[field.name] ?? ''}
                      onChange={(e) =>
                        setArgValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                      }
                      className={`${formControlClassName} min-h-[60px] resize-y font-mono text-xs`}
                      placeholder={field.type === 'array' ? '["a", "b"]' : '{"key": "value"}'}
                    />
                  ) : (
                    <input
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={argValues[field.name] ?? ''}
                      onChange={(e) =>
                        setArgValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                      }
                      className={formControlClassName}
                      placeholder={field.description || field.name}
                    />
                  )}
                  {field.description && (
                    <p className="text-xs text-text-tertiary mt-0.5">{field.description}</p>
                  )}
                </FormField>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-tertiary italic">此工具没有参数</p>
          )}

          {/* Execute button */}
          <div className="flex justify-end">
            <button
              onClick={handleExecute}
              disabled={execState === 'running' || !isSafe}
              className="px-4 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {execState === 'running' ? '执行中...' : '执行'}
            </button>
          </div>

          {/* Error message */}
          {errorMsg && (
            <div className="rounded-lg border border-error-200 bg-error-50 p-3">
              <p className="text-sm text-error-700">{errorMsg}</p>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-text-secondary">执行结果</label>
                <Badge colorClass={result.isError ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}>
                  {result.isError ? '错误' : '成功'}
                </Badge>
              </div>
              <pre className="text-xs text-text-primary bg-bg-primary border border-border-base rounded-lg p-3 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-all">
                {result.content.map((c) => c.text).join('\n')}
              </pre>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
