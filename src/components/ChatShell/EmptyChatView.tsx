// EmptyChatView - 空聊天视图组件
// 显示当没有选中聊天或聊天中没有消息时的问候界面

import { useState } from 'react'
// Components
import Sender from '../Sender'
// Store
import { useUserStore } from '../../store/userStore'
// Utils
import { getTimePeriod } from '../../utils/time'

/**
 * 空聊天视图组件
 * 显示当没有选中聊天或聊天中没有消息时的问候界面
 */
export default function EmptyChatView() {
  const { user } = useUserStore()

  // 使用 useState 初始化问候语，避免在渲染期间调用 Date.now()
  const [greetingPrefix] = useState(() => {
    const now = Date.now()
    const period = getTimePeriod(now)
    return period === '凌晨' ? '夜深了' : `${period}好`
  })

  return (
    <div className="flex flex-col h-full justify-center items-center gap-10 w-full max-w-4xl">
      <span className="text-3xl font-sans text-text-primary text-center">
        {greetingPrefix}，{user?.username ?? '用户'}，有什么可以帮你的吗？
      </span>
      <Sender />
    </div>
  )
}

