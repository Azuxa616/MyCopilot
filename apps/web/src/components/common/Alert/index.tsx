// Alert - 全局提示组件
// 提供成功、错误、警告、信息等类型的全局提示

import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
// Types
import type { AlertType, AlertItem } from './alertUtils'
// Utils
import { removeAlert, addListener, removeListener, getAlerts } from './alertUtils'
// Assets
import IconSuccess from '../../../assets/icon/success.svg?react'
import IconError from '../../../assets/icon/error.svg?react'
import IconWarning from '../../../assets/icon/warning.svg?react'
import IconInfo from '../../../assets/icon/info.svg?react'

// TypeIcon 组件移到外部，避免在渲染期间创建
function TypeIcon({ type }: { type: AlertType }) {
  switch (type) {
    case 'success':
      return <IconSuccess className="w-4 h-4" />
    case 'error':
      return <IconError className="w-4 h-4" />
    case 'warning':
      return <IconWarning className="w-4 h-4" />
    case 'info':
      return <IconInfo className="w-4 h-4" />
    default:
      return null
  }
}

// 单个提示项组件
function AlertItem({ alert, onRemove }: { alert: AlertItem; onRemove: (id: string) => void }) {
  const [isVisible, setIsVisible] = useState(false)
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    // 进入动画
    const enterTimer = setTimeout(() => setIsVisible(true), 10)
    
    // 自动消失
    const duration = alert.duration ?? 3000
    const exitTimer = setTimeout(() => {
      setIsExiting(true)
      // 等待退出动画完成后移除
      setTimeout(() => {
        onRemove(alert.id)
      }, 200) // 与 CSS transition 时间一致
    }, duration)

    return () => {
      clearTimeout(enterTimer)
      clearTimeout(exitTimer)
    }
  }, [alert.id, alert.duration, onRemove])

  const getTypeStyles = () => {
    switch (alert.type) {
      case 'success':
        return 'bg-success-light/20 text-success-dark border-success'
      case 'error':
        return 'bg-error-light/20 text-error-dark border-error'
      case 'warning':
        return 'bg-warning-light/20 text-warning-dark border-warning'
      case 'info':
        return 'bg-info-light/20 text-info-dark border-info'
      default:
        return 'bg-info-light/20 text-info-dark border-info'
    }
  }

  return (
    <div
      className={`
        ${getTypeStyles()}
        px-4 py-3 rounded-lg border shadow-lg
        max-w-[500px] overflow-hidden
        transition-all duration-300 ease-in-out
        ${isVisible && !isExiting ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}
        ${isExiting ? 'scale-95' : 'scale-100'}
      `}
      role="alert"
    >
      <div className="flex items-center justify-between gap-3">
        <TypeIcon type={alert.type} />
        <span className="text-sm font-medium flex-1">{alert.message}</span>
      </div>
    </div>
  )
}

// 全局提示容器组件
function AlertContainer() {
  const [alertList, setAlertList] = useState<AlertItem[]>([])

  useEffect(() => {
    // 注册监听器
    const listener = (newAlerts: AlertItem[]) => {
      setAlertList(newAlerts)
    }
    addListener(listener)
    // 初始化时设置当前状态 - 使用 setTimeout 避免在 effect 中同步调用 setState
    setTimeout(() => {
      setAlertList(getAlerts())
    }, 0)

    // 清理函数
    return () => {
      removeListener(listener)
    }
  }, [])

  const handleRemove = useCallback((id: string) => {
    removeAlert(id)
  }, [])

  if (alertList.length === 0) return null

  return createPortal(
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-3 items-center pointer-events-none w-full max-w-[calc(100vw-2rem)] px-4"
    >
      {alertList.map((alert) => (
        <div key={alert.id} className="pointer-events-auto">
          <AlertItem alert={alert} onRemove={handleRemove} />
        </div>
      ))}
    </div>,
    document.body
  )
}

// 默认导出组件
export default AlertContainer
