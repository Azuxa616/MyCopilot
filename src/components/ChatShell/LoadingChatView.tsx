// LoadingChatView - 加载中视图组件

/**
 * 加载中视图组件
 * 显示当聊天消息正在加载时的界面
 */
export default function LoadingChatView() {
  return (
    <div className="flex flex-col h-full justify-center items-center gap-10 w-full max-w-4xl">
      <span className="text-lg text-text-secondary">加载中...</span>
    </div>
  )
}

