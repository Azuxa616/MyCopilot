// MainView - Main chat view
// Contains ChatShell and the tool confirmation dialog (shown during chat).

import { Suspense, lazy } from 'react'
import { useSessionStore } from '../store/sessionStore'
import ToolConfirmationDialog from '../components/ToolConfirmationDialog'

const ChatShell = lazy(() => import('../components/ChatShell'))

export function MainView() {
  const pendingConfirmation = useSessionStore((s) => s.pendingConfirmation)
  const resolveConfirmation = useSessionStore((s) => s.resolveConfirmation)

  return (
    <div className="flex flex-col h-full w-full items-center bg-bg-elevated text-text-primary overflow-hidden">
      <Suspense fallback={<div className="flex items-center justify-center h-full w-full">加载中...</div>}>
        <ChatShell />
      </Suspense>
      <ToolConfirmationDialog
        confirmation={pendingConfirmation}
        onResolve={resolveConfirmation}
      />
    </div>
  )
}
