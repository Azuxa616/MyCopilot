// DebugBadge - Floating "Dev" badge shown only in development.
// Double gating layer 1: early return when not DEV so the JSX below is
// dead code in production builds (combined with the lazy conditional import
// in Layout.tsx this ensures prod bundles never include debug UI).

import { useDebugStore } from '../../store/debugStore'

export default function DebugBadge() {
  // Hooks must run unconditionally (rules-of-hooks); the store subscription is
  // cheap and the component is never even imported in prod (gating layer 2).
  const openModal = useDebugStore((s) => s.openModal)

  // Gating layer 1 — render nothing in production builds.
  if (!import.meta.env.DEV) return null

  return (
    <button
      type="button"
      data-testid="dev-badge"
      onClick={openModal}
      className="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-amber-500 rounded-full shadow-lg hover:bg-amber-600 transition-colors cursor-pointer"
      aria-label="Open debug information"
    >
      <span aria-hidden="true">🔧</span>
      <span>Dev</span>
    </button>
  )
}
