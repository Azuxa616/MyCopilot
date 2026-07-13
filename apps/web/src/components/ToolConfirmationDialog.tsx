// ToolConfirmationDialog - Modal shown when a tool call requires user approval.
// Restricted tools: confirm once per session; Danger tools: confirm every call.
// Design ref: docs/2026-07-11-tool-safety-system-design.md §6.2

import { useState, useEffect } from 'react'
import Modal from './common/Modal'
import type { ConfirmationEventData } from '../utils/streamUtils'

export interface ToolConfirmationDialogProps {
  confirmation: ConfirmationEventData | null
  onResolve: (approvalId: string, approved: boolean) => void
}

export default function ToolConfirmationDialog({
  confirmation,
  onResolve,
}: ToolConfirmationDialogProps) {
  const [isResolving, setIsResolving] = useState(false)

  // Reset resolving state when a new confirmation arrives
  useEffect(() => {
    setIsResolving(false)
  }, [confirmation?.approvalId])

  const isDanger = confirmation?.safetyLevel === 'danger'
  const isRestricted = confirmation?.safetyLevel === 'restricted'

  const handleResolve = (approved: boolean) => {
    if (!confirmation || isResolving) return
    setIsResolving(true)
    onResolve(confirmation.approvalId, approved)
  }

  // Pretty-print JSON arguments if possible
  const formatArgs = (args: string): string => {
    try {
      return JSON.stringify(JSON.parse(args), null, 2)
    } catch {
      return args
    }
  }

  return (
    <Modal
      open={confirmation !== null}
      onOpenChange={() => {}} // Prevent closing without explicit choice
      showClose={false}
      maskClosable={false}
      title={isDanger ? '🔴 危险操作确认' : '🔧 工具使用确认'}
      width="520px"
    >
      {confirmation && (
        <div className="flex flex-col gap-4">
          {/* Tool info */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">
                {confirmation.toolName}
              </span>
              <span className="text-xs text-text-tertiary">
                来源: {confirmation.source}
                {confirmation.sourceMcpId ? ` (${confirmation.sourceMcpId})` : ''}
              </span>
            </div>
            {confirmation.resourceScope && (
              <span className="text-xs text-text-tertiary">
                资源范围: {confirmation.resourceScope}
              </span>
            )}
          </div>

          {/* Arguments */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">参数</label>
            <pre className="text-xs text-text-primary bg-bg-primary border border-border-base rounded-lg p-3 overflow-x-auto max-h-40 overflow-y-auto">
              {formatArgs(confirmation.arguments)}
            </pre>
          </div>

          {/* Warning message */}
          <div
            className={`text-sm rounded-lg p-3 border ${
              isDanger
                ? 'bg-error-50 border-error-200 text-error-700'
                : 'bg-amber-50 border-amber-200 text-amber-700'
            }`}
          >
            {isDanger && (
              <p>这是危险操作，每次执行都需要确认。</p>
            )}
            {isRestricted && (
              <p>
                这是受限工具，需要您确认。确认后本会话内将不再重复询问此工具。
              </p>
            )}
            {!isDanger && !isRestricted && (
              <p>需要您确认后继续。</p>
            )}
          </div>

          {/* Expiry hint */}
          {confirmation.expiresAt > 0 && (
            <p className="text-xs text-text-tertiary">
              有效期至: {new Date(confirmation.expiresAt).toLocaleTimeString()}
            </p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 mt-2">
            <button
              onClick={() => handleResolve(false)}
              disabled={isResolving}
              className="px-4 py-2 text-sm text-text-primary bg-bg-secondary border border-border-base rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
            >
              拒绝
            </button>
            <button
              onClick={() => handleResolve(true)}
              disabled={isResolving}
              className={`px-4 py-2 text-sm text-white rounded-lg transition-colors font-medium disabled:opacity-50 ${
                isDanger
                  ? 'bg-error-600 hover:bg-error-700'
                  : 'bg-primary-500 hover:bg-primary-600'
              }`}
            >
              {isResolving ? '处理中...' : '允许'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
