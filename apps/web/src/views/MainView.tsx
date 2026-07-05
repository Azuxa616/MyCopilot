// MainView - Main chat view
// Contains ChatShell only (sidebar moved to Layout)

import { Suspense, lazy } from 'react'

const ChatShell = lazy(() => import('../components/ChatShell'))

export function MainView() {
  return (
    <div className="flex flex-col h-full w-full items-center bg-bg-elevated text-text-primary overflow-hidden">
      <Suspense fallback={<div className="flex items-center justify-center h-full w-full">加载中...</div>}>
        <ChatShell />
      </Suspense>
    </div>
  )
}
