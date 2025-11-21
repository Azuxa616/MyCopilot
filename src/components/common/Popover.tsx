import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  type ReactNode,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
  isValidElement,
  cloneElement,
} from 'react'
import { createPortal } from 'react-dom'

export type PopoverTrigger = 'hover' | 'click'
export type PopoverPlacement = 'top' | 'bottom' | 'left' | 'right'

export interface PopoverProps {
  /** 触发元素，必须是能够接受 ref 的 ReactElement */
  children: ReactNode
  /** 气泡内容 */
  content: ReactNode
  /** 触发方式 */
  trigger?: PopoverTrigger
  /** 气泡位置 */
  placement?: PopoverPlacement
  /** 是否可见（受控模式） */
  open?: boolean
  /** 可见状态变化回调 */
  onOpenChange?: (open: boolean) => void
  /** 气泡内容自定义类名 */
  className?: string
}

export default function Popover({
  children,
  content,
  trigger = 'hover',
  placement = 'bottom',
  open: controlledOpen,
  onOpenChange,
  className = '',
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : internalOpen

  const setOpen = (newOpen: boolean) => {
    if (!isControlled) {
      setInternalOpen(newOpen)
    }
    onOpenChange?.(newOpen)
  }

  // 计算位置的核心逻辑
  const updatePosition = () => {
    if (!triggerRef.current || !popoverRef.current) return

    const triggerRect = triggerRef.current.getBoundingClientRect()
    const popoverRect = popoverRef.current.getBoundingClientRect()
    const gap = 8 // 间距

    let top = 0
    let left = 0

    switch (placement) {
      case 'top':
        top = triggerRect.top - popoverRect.height - gap
        left = triggerRect.left + triggerRect.width / 2 - popoverRect.width / 2
        break
      case 'bottom':
        top = triggerRect.bottom + gap
        left = triggerRect.left + triggerRect.width / 2 - popoverRect.width / 2
        break
      case 'left':
        top = triggerRect.top + triggerRect.height / 2 - popoverRect.height / 2
        left = triggerRect.left - popoverRect.width - gap
        break
      case 'right':
        top = triggerRect.top + triggerRect.height / 2 - popoverRect.height / 2
        left = triggerRect.right + gap
        break
    }

    // 简单的边界检测（可选，这里先保留基础逻辑，后续可增强）
    setPosition({ top, left })
  }

  // 使用 useLayoutEffect 在浏览器绘制前计算位置，避免闪烁
  useLayoutEffect(() => {
    if (isOpen) {
      updatePosition()
      // 监听滚动和窗口大小变化
      window.addEventListener('scroll', updatePosition, true)
      window.addEventListener('resize', updatePosition)
    } else {
      setPosition(null) // 重置位置
    }

    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [isOpen, placement])

  // 监听气泡框尺寸变化（应对内容动态变化）
  useEffect(() => {
    if (!isOpen || !popoverRef.current) return
    const resizeObserver = new ResizeObserver(updatePosition)
    resizeObserver.observe(popoverRef.current)
    return () => resizeObserver.disconnect()
  }, [isOpen])

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen || trigger !== 'click') return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return
      }
      setOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, trigger])

  // 处理 Trigger 元素的事件和 Ref
  const triggerElement = isValidElement(children) ? children : <span>{children}</span>

  const clonedTrigger = cloneElement(triggerElement as ReactElement, {
    // @ts-ignore
    ref: (node: HTMLElement) => {
      triggerRef.current = node
      // 保留原有的 ref
      const { ref } = triggerElement as any
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    onClick: (e: ReactMouseEvent) => {
      triggerElement.props.onClick?.(e)
      if (trigger === 'click') setOpen(!isOpen)
    },
    onMouseEnter: (e: ReactMouseEvent) => {
      triggerElement.props.onMouseEnter?.(e)
      if (trigger === 'hover') setOpen(true)
    },
    onMouseLeave: (e: ReactMouseEvent) => {
      triggerElement.props.onMouseLeave?.(e)
      if (trigger === 'hover') setOpen(false)
    },
  })

  const popoverContent = isOpen && (
    <div
      ref={popoverRef}
      className={`fixed z-50 bg-bg-elevated border border-border-base rounded-lg shadow-lg p-3 text-sm text-text-primary transition-opacity duration-200 ${className}`}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        opacity: position ? 1 : 0, // 位置计算好之前隐藏
        pointerEvents: position ? 'auto' : 'none',
      }}
      onMouseEnter={() => trigger === 'hover' && setOpen(true)}
      onMouseLeave={() => trigger === 'hover' && setOpen(false)}
    >
      {content}
    </div>
  )

  return (
    <>
      {clonedTrigger}
      {popoverContent && createPortal(popoverContent, document.body)}
    </>
  )
}
