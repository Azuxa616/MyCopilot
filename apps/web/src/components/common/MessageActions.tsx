// MessageActions - 消息操作按钮组件
// 包含复制、删除、重试等操作按钮

import type { ReactNode } from 'react'
// Assets
import IconCopy from '../../assets/icon/copy.svg?react'
import IconDelete from '../../assets/icon/delete.svg?react'
import IconRetry from '../../assets/icon/retry.svg?react'
interface MessageActionsProps {
  /** 所属发送者 */
  sender: 'user' | 'assistant'
  /** 状态文本（发送中、发送失败等） */
  statusText?: string
  /** 是否显示重试按钮 */
  showRetry?: boolean
  /** 是否显示重新生成按钮 */
  showRegenerate?: boolean
  /** 点击复制回调 */
  onCopy?: () => void
  /** 点击删除回调 */
  onDelete?: () => void
  /** 点击重试回调 */
  onRetry?: () => void
  /** 点击重新生成回调 */
  onRegenerate?: () => void
  /** 自定义操作区域 */
  extraActions?: ReactNode
}

/**
 * 消息操作按钮组件
 * 包含复制、删除、重试等操作按钮
 */
export default function MessageActions({
  sender,
  showRetry,
  showRegenerate,
  onCopy,
  onDelete,
  onRetry,
  onRegenerate,

  extraActions,
}: MessageActionsProps) {
  return (
    <div className={`mt-1 flex items-center justify-${sender === 'user' ? 'end' : 'start'} gap-1 text-[11px] px-2 mt-1`}>
      {onCopy && (
        <button
          type="button"
          onClick={onCopy}
          className="p-1 py-0.5 rounded-md hover:bg-bg-hover text-[11px]"
          aria-label="复制消息内容"
        >
          <IconCopy className="w-4 h-4" />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="px-1 py-0.5 rounded-md hover:bg-bg-hover text-[11px] text-error"
          aria-label="删除消息"
        >
          <IconDelete className="w-4 h-4" />
        </button>
      )}
      {showRetry && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-1 py-0.5 rounded-md bg-error-light/40 text-error-dark hover:bg-error-light/60 text-[11px]"
          aria-label="重试发送消息"
        >
          <IconRetry className="w-4 h-4" />
        </button>
      )}
      {showRegenerate && onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          className="px-1 py-0.5 rounded-md hover:bg-bg-hover text-[11px]"
          aria-label="重新生成AI回复"
        >
          <IconRetry className="w-4 h-4" />
        </button>
      )}
      {extraActions}
    </div>
  )
}

