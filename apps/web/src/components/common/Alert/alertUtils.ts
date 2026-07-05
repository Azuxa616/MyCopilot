// 提示类型
export type AlertType = 'success' | 'error' | 'warning' | 'info'

// 提示项接口
interface AlertItem {
  id: string
  type: AlertType
  message: string
  duration?: number // 自动消失时间（毫秒），默认 3000
}

let alertListeners: Array<(alerts: AlertItem[]) => void> = []
let alerts: AlertItem[] = []

const notifyListeners = () => {
  alertListeners.forEach((listener) => listener([...alerts]))
}

const addAlert = (alert: Omit<AlertItem, 'id'>) => {
  const id = `alert-${Date.now()}-${Math.random()}`
  alerts = [...alerts, { ...alert, id }]
  notifyListeners()
}

const removeAlert = (id: string) => {
  alerts = alerts.filter((alert) => alert.id !== id)
  notifyListeners()
}

// 提供管理监听器的函数
const addListener = (listener: (alerts: AlertItem[]) => void) => {
  alertListeners.push(listener)
}

const removeListener = (listener: (alerts: AlertItem[]) => void) => {
  alertListeners = alertListeners.filter((l) => l !== listener)
}

const getAlerts = () => [...alerts]

// 导出提示函数
export const showMessageAlert = {
  success: (message: string, duration?: number) => {
    addAlert({ type: 'success', message, duration })
  },
  error: (message: string, duration?: number) => {
    addAlert({ type: 'error', message, duration })
  },
  warning: (message: string, duration?: number) => {
    addAlert({ type: 'warning', message, duration })
  },
  info: (message: string, duration?: number) => {
    addAlert({ type: 'info', message, duration })
  },
}

// 导出内部函数供 Alert 组件使用
export { removeAlert, addListener, removeListener, getAlerts }
export type { AlertItem }

