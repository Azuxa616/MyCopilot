/**
 * Popover 气泡提示组件
 * 
 * 自动计算位置并支持响应式调整
 */
import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  type ReactNode,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
  isValidElement,
  cloneElement,
} from 'react'
import { createPortal } from 'react-dom'

/** 触发方式：悬停或点击 */
export type PopoverTrigger = 'hover' | 'click'

/** 气泡位置：上下左右四个方向 */
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

  /**
   * 设置打开状态的统一方法
   * 受控模式：只调用回调，不更新内部状态
   * 非受控模式：更新内部状态并调用回调
   */
  const setOpen = useCallback((newOpen: boolean) => {
    if (!isControlled) {
      setInternalOpen(newOpen)
    }
    onOpenChange?.(newOpen)
  }, [isControlled, onOpenChange])

  /**
   * 计算气泡位置的核心逻辑
   * 根据触发元素和气泡容器的位置、尺寸，以及指定的 placement 方向计算最终坐标
   */
  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !popoverRef.current) return

    // 获取触发元素和气泡容器的位置信息
    const triggerRect = triggerRef.current.getBoundingClientRect()
    const popoverRect = popoverRef.current.getBoundingClientRect()
    const gap = 8 // 触发元素与气泡之间的间距（像素）

    let top = 0
    let left = 0

    // 根据 placement 方向计算位置
    switch (placement) {
      case 'top':
        // 气泡显示在触发元素上方，水平居中
        top = triggerRect.top - popoverRect.height - gap
        left = triggerRect.left + triggerRect.width / 2 - popoverRect.width / 2
        break
      case 'bottom':
        // 气泡显示在触发元素下方，水平居中
        top = triggerRect.bottom + gap
        left = triggerRect.left + triggerRect.width / 2 - popoverRect.width / 2
        break
      case 'left':
        // 气泡显示在触发元素左侧，垂直居中
        top = triggerRect.top + triggerRect.height / 2 - popoverRect.height / 2
        left = triggerRect.left - popoverRect.width - gap
        break
      case 'right':
        // 气泡显示在触发元素右侧，垂直居中
        top = triggerRect.top + triggerRect.height / 2 - popoverRect.height / 2
        left = triggerRect.right + gap
        break
    }

    // 更新位置状态（后续可以在这里添加边界检测逻辑，防止气泡超出视口）
    setPosition({ top, left })
  }, [placement])

  /**
   * 位置计算和监听
   * 使用 useLayoutEffect 在浏览器绘制前计算位置，避免闪烁
   * 监听滚动和窗口大小变化，自动更新位置
   */
  useLayoutEffect(() => {
    if (isOpen) {
      // 打开时立即计算位置
      updatePosition()
      // 监听滚动事件（使用 capture 模式捕获所有滚动）
      window.addEventListener('scroll', updatePosition, true)
      // 监听窗口大小变化
      window.addEventListener('resize', updatePosition)
    } else {
      // 关闭时重置位置
      setPosition(null)
    }

    // 清理事件监听器
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [isOpen, placement, updatePosition])

  /**
   * 监听气泡框尺寸变化
   * 当气泡内容动态变化（如异步加载）导致尺寸改变时，自动重新计算位置
   */
  useEffect(() => {
    if (!isOpen || !popoverRef.current) return
    
    const resizeObserver = new ResizeObserver(updatePosition)
    resizeObserver.observe(popoverRef.current)
    
    return () => resizeObserver.disconnect()
  }, [isOpen, updatePosition])

  /**
   * 点击外部关闭功能
   * 仅在 click 触发模式下生效，点击触发元素和气泡外部区域时关闭
   */
  useEffect(() => {
    if (!isOpen || trigger !== 'click') return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      // 如果点击的是触发元素或气泡内部，不关闭
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return
      }
      // 点击外部区域，关闭气泡
      setOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, trigger, setOpen])

  /**
   * 处理触发元素
   */
  const triggerElement = isValidElement(children) ? children : <span>{children}</span>

  /**
   * 保存触发元素的原始 ref
   * 用于在合并 ref 时保留用户传入的 ref
   */
  const originalRef = useRef<React.Ref<HTMLElement> | undefined>(undefined)
  if (isValidElement(triggerElement)) {
    originalRef.current = (triggerElement as ReactElement & { ref?: React.Ref<HTMLElement> }).ref
  }

  /**
   * Ref 回调函数
   * 合并内部 ref（用于位置计算）和用户传入的 ref
   * 支持函数式 ref 和对象式 ref 两种形式
   */
  const refCallback = useCallback((node: HTMLElement | null) => {
    // 设置内部 ref，用于位置计算
    triggerRef.current = node
    
    // 保留用户传入的原始 ref
    const ref = originalRef.current
    if (ref) {
      if (typeof ref === 'function') {
        // 函数式 ref：直接调用
        ref(node)
      } else if (ref && typeof ref === 'object' && 'current' in ref) {
        // 对象式 ref：设置 current 属性
        // eslint-disable-next-line react-hooks/immutability
        ;(ref as { current: HTMLElement | null }).current = node
      }
    }
  }, [])

  /**
   * 克隆触发元素并注入事件处理器和 ref
   * 保留原有的事件处理器，同时添加 Popover 的交互逻辑
   */
  const clonedTrigger = cloneElement(
    triggerElement as ReactElement,
    {
      ref: refCallback,
      // 点击事件：保留原有处理，添加切换打开状态逻辑
      onClick: (e: ReactMouseEvent) => {
        triggerElement.props.onClick?.(e)
        if (trigger === 'click') setOpen(!isOpen)
      },
      // 鼠标进入：hover 模式下打开气泡
      onMouseEnter: (e: ReactMouseEvent) => {
        triggerElement.props.onMouseEnter?.(e)
        if (trigger === 'hover') setOpen(true)
      },
      // 鼠标离开：hover 模式下关闭气泡
      onMouseLeave: (e: ReactMouseEvent) => {
        triggerElement.props.onMouseLeave?.(e)
        if (trigger === 'hover') setOpen(false)
      },
    } as any
  )

  /**
   * 气泡内容
   */
  const popoverContent = isOpen && (
    <div
      ref={popoverRef}
      className={`fixed z-50 bg-bg-elevated border border-border-base rounded-lg shadow-lg p-3 text-sm text-text-primary transition-opacity duration-200 ${className}`}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        // 位置计算完成前隐藏，避免闪烁
        opacity: position ? 1 : 0,
        // 位置未计算完成时禁用交互，避免误触
        pointerEvents: position ? 'auto' : 'none',
      }}
      // hover 模式下，鼠标移入气泡时保持打开状态
      onMouseEnter={() => trigger === 'hover' && setOpen(true)}
      // hover 模式下，鼠标离开气泡时关闭
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
