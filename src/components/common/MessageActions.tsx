import type { ReactNode } from 'react'

interface MessageActionsProps {
  /** 状态文本（发送中、发送失败等） */
  statusText?: string
  /** 是否显示重试按钮 */
  showRetry?: boolean
  /** 点击复制回调 */
  onCopy?: () => void
  /** 点击删除回调 */
  onDelete?: () => void
  /** 点击重试回调 */
  onRetry?: () => void
  /** 自定义操作区域 */
  extraActions?: ReactNode
}

/**
 * 消息操作按钮组件
 * 包含复制、删除、重试等操作按钮
 */
export default function MessageActions({
  statusText,
  showRetry,
  onCopy,
  onDelete,
  onRetry,
  extraActions,
}: MessageActionsProps) {
  return (
    <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-text-tertiary">
      {statusText && <span>{statusText}</span>}
      {onCopy && (
        <button
          type="button"
          onClick={onCopy}
          className="px-1 py-0.5 rounded-md hover:bg-bg-hover text-[11px]"
          aria-label="复制消息内容"
        >
          复制
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="px-1 py-0.5 rounded-md hover:bg-bg-hover text-[11px] text-error"
          aria-label="删除消息"
        >
          删除
        </button>
      )}
      {showRetry && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-1 py-0.5 rounded-md bg-error-light/40 text-error-dark hover:bg-error-light/60 text-[11px]"
          aria-label="重试发送消息"
        >
          重试
        </button>
      )}
      {extraActions}
    </div>
  )
}

