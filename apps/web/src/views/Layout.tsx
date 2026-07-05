// Layout - Root layout with sidebar and main content area
// Contains Asider (shared sidebar) + Outlet for route content
// Also handles app initialization and global overlays (AlertContainer, TokenModal)

import { useState, useEffect, useRef, Suspense, lazy } from 'react'
import { Outlet } from 'react-router-dom'

// Store
import { useSessionStore } from '../store/sessionStore'
import { useConfigStore } from '../store/configStore'

// Lazy load components to keep bundle lean
const Asider = lazy(() => import('../components/Asider/index'))
const AlertContainer = lazy(() => import('../components/common/Alert'))
const TokenModal = lazy(() => import('../components/TokenModal'))

export function Layout() {
  const [isCollapsed, setIsCollapsed] = useState(false)

  // Token modal state
  const authToken = useConfigStore((state) => state.authToken)
  const isTokenModalOpen = useConfigStore((state) => state.isTokenModalOpen)
  const submitAuthToken = useConfigStore((state) => state.submitAuthToken)
  const showTokenModal = !authToken || isTokenModalOpen

  // App initialization (moved from App.tsx)
  const loadSessionSummaries = useSessionStore((state) => state.loadSessionSummaries)
  const setSelectedSessionId = useSessionStore((state) => state.setSelectedSessionId)

  const hasInitialized = useRef(false)

  useEffect(() => {
    if (hasInitialized.current) {
      return
    }
    hasInitialized.current = true

    const initApp = async () => {
      try {
        // Load session summaries from server
        await loadSessionSummaries()

        const store = useSessionStore.getState()
        if (store.sessionSummaries.length > 0) {
          // sessionStore is not persisted, so selectedSessionId is always '' on load — select first.
          setSelectedSessionId(store.sessionSummaries[0].id)
        }
        // If no sessions, stay in "empty" state — user clicks New Session to start
      } catch (error) {
        console.error('App initialization failed:', error)
      }
    }

    initApp()
  }, [loadSessionSummaries, setSelectedSessionId])

  return (
    <div className="flex h-screen w-screen bg-bg-primary overflow-hidden">
      <aside className={`flex h-full shrink-0 border-r border-border-base transition-all duration-300 ${isCollapsed ? 'w-16' : 'w-64'}`}>
        <Suspense fallback={<div className="flex items-center justify-center h-full w-full">加载中...</div>}>
          <Asider
            isCollapsed={isCollapsed}
            onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
          />
        </Suspense>
      </aside>
      <main className="flex-1 flex flex-col items-center bg-bg-elevated text-text-primary overflow-hidden">
        <Outlet />
      </main>

      {/* Global alert container */}
      <Suspense fallback={null}>
        <AlertContainer />
      </Suspense>

      {/* Token modal - shown when no auth token or explicitly opened */}
      <Suspense fallback={null}>
        {showTokenModal && (
          <TokenModal
            open={showTokenModal}
            onSubmit={submitAuthToken}
          />
        )}
      </Suspense>
    </div>
  )
}
