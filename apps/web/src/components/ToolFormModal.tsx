import { useState } from 'react'
import type { SafetyLevel, Tool, UpdateToolParams } from '@my-copilot/shared'
import Modal from './common/Modal'
import { FormField, formControlClassName } from './common/FormField'

export interface ToolFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tool?: Tool
  onSubmit: (params: UpdateToolParams) => void
}

const SAFETY_LEVELS: SafetyLevel[] = ['restricted', 'danger']

const safetyLevelLabel: Record<SafetyLevel, string> = {
  safe: '安全（自动执行）',
  restricted: '受限（按资源范围首次确认）',
  danger: '危险（每次确认）',
}

export default function ToolFormModal({
  open,
  onOpenChange,
  tool,
  onSubmit,
}: ToolFormModalProps) {
  const [safetyLevel, setSafetyLevel] = useState<SafetyLevel>('restricted')

  // 打开弹窗或切换目标工具时同步安全级别。
  // 渲染期守卫式状态调整（react.dev "You Might Not Need an Effect"），
  // 哨兵 null 保证首帧即执行，与原 mount effect 行为一致。
  const [hydratedFor, setHydratedFor] = useState<{ open: boolean; tool: Tool | undefined } | null>(
    null,
  )
  if (hydratedFor === null || hydratedFor.open !== open || hydratedFor.tool !== tool) {
    setHydratedFor({ open, tool })
    if (open && tool) setSafetyLevel(tool.safetyLevel)
  }

  const handleSubmit = () => {
    if (!tool) return
    onSubmit({ safetyLevel })
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="工具安全策略"
      width="560px"
    >
      {tool ? (
        <div className="flex flex-col gap-5">
          <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-text-primary">{tool.name}</p>
                <p className="mt-1 text-xs text-text-secondary">{tool.description || '无描述'}</p>
              </div>
              <span className="shrink-0 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700">
                MCP 同步
              </span>
            </div>
            <p className="mt-3 font-mono text-[11px] text-text-tertiary">
              来源：{tool.sourceMcpId ?? '未知 MCP'}
            </p>
          </div>

          <FormField label="安全级别" required>
            <select
              value={safetyLevel}
              onChange={(event) => setSafetyLevel(event.target.value as SafetyLevel)}
              className={formControlClassName}
            >
              {SAFETY_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {safetyLevelLabel[level]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-text-tertiary">
              MCP 工具至少为“受限”；你可以提高为“危险”，不能降低为自动执行。
            </p>
          </FormField>

          <div className="rounded-lg border border-border-base bg-bg-secondary px-4 py-3">
            <p className="text-xs font-medium text-text-secondary">输入参数由 MCP Server 维护</p>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-text-tertiary">
              {JSON.stringify(tool.inputSchema, null, 2)}
            </pre>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg border border-border-base bg-bg-secondary px-4 py-2 text-sm text-text-primary transition-colors hover:bg-bg-hover"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600"
            >
              保存策略
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
