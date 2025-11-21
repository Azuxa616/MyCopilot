import { useState, useEffect, type ReactNode } from 'react'

export interface ModalProps {
  /** 是否可见（受控模式） */
  open?: boolean
  /** 可见状态变化回调 */
  onOpenChange?: (open: boolean) => void
  /** 模态框标题 */
  title?: ReactNode
  /** 模态框内容 */
  children: ReactNode
  /** 是否显示关闭按钮 */
  showClose?: boolean
  /** 点击遮罩层是否关闭 */
  maskClosable?: boolean
  /** 自定义类名 */
  className?: string
  /** 自定义内容类名 */
  contentClassName?: string
  /** 自定义遮罩类名 */
  maskClassName?: string
  /** 宽度 */
  width?: string | number
}

export default function Modal({
  open: controlledOpen,
  onOpenChange,
  title,
  children,
  showClose = true,
  maskClosable = true,
  className = '',
  contentClassName = '',
  maskClassName = '',
  width = '520px',
}: ModalProps) {
  const [internalOpen, setInternalOpen] = useState(false)

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen

  const setOpen = (newOpen: boolean) => {
    if (!isControlled) {
      setInternalOpen(newOpen)
    }
    onOpenChange?.(newOpen)
  }

  // ESC 键关闭
  useEffect(() => {
    if (!open) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open])

  // 阻止 body 滚动
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // 点击遮罩层关闭
  const handleMaskClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (maskClosable && e.target === e.currentTarget) {
      setOpen(false)
    }
  }

  if (!open) return null

  const widthValue = typeof width === 'number' ? `${width}px` : width

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${className}`}
      onClick={handleMaskClick}
    >
      {/* 遮罩层 */}
      <div
        className={`absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0'
        } ${maskClassName}`}
      />

      {/* 模态框内容 - 使用内联样式支持动态宽度 */}
      <div
        className={`relative z-10 bg-bg-elevated border border-border-base rounded-lg shadow-xl transition-all duration-200 max-w-[90vw] max-h-[90vh] ${
          open ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        } ${contentClassName}`}
        style={{ width: widthValue }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        {(title || showClose) && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-base">
            {title && (
              <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
            )}
            {showClose && (
              <button
                onClick={() => setOpen(false)}
                className="ml-auto text-text-secondary hover:text-text-primary transition-colors p-1 rounded hover:bg-bg-hover"
                aria-label="关闭"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* 内容区域 */}
        <div className="px-6 py-4 overflow-y-auto max-h-[calc(90vh-80px)]">
          {children}
        </div>
      </div>
    </div>
  )
}

