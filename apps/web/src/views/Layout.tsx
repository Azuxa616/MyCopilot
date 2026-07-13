// Layout - Root layout with sidebar and main content area
// Contains Asider (shared sidebar) + Outlet for route content
// Also handles app initialization and global overlays (AlertContainer, TokenModal)

import { useState, useEffect, Suspense, lazy } from 'react'
import { Outlet } from 'react-router-dom'

// Store
import { useSessionStore } from '../store/sessionStore'
import { useConfigStore } from '../store/configStore'

// Lazy load components to keep bundle lean
const Asider = lazy(() => import('../components/Asider/index'))
const AlertContainer = lazy(() => import('../components/common/Alert'))
const TokenModal = lazy(() => import('../components/TokenModal'))

// Debug overlay — lazy + conditional so prod builds strip debug code entirely
// (gating layer 2; layer 1 is the early-return inside each component).
const DebugBadge = lazy(() => import('../components/debug/DebugBadge'))
const DebugModal = lazy(() => import('../components/debug/DebugModal'))

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

  // Load sessions whenever authToken becomes available.
  // Re-runs when authToken transitions (null → valid), fixing the
  // "first login doesn't auto-load sessions until manual refresh" bug.
  useEffect(() => {
    if (!authToken) return

    let cancelled = false

    const initApp = async () => {
      try {
        await loadSessionSummaries()
        if (cancelled) return

        const store = useSessionStore.getState()
        if (store.sessionSummaries.length > 0 && !store.selectedSessionId) {
          // sessionStore is not persisted, so selectedSessionId is always '' on load — select first.
          setSelectedSessionId(store.sessionSummaries[0].id)
        }
        // If no sessions, stay in "empty" state — user clicks New Session to start
      } catch (error) {
        console.error('App initialization failed:', error)
      }
    }

    initApp()
    return () => { cancelled = true }
  }, [authToken, loadSessionSummaries, setSelectedSessionId])

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

      {/* Debug overlay — dev only, double-gated (conditional import + early return) */}
      {import.meta.env.DEV && (
        <Suspense fallback={null}>
          <DebugBadge />
          <DebugModal />
        </Suspense>
      )}
    </div>
  )
}
