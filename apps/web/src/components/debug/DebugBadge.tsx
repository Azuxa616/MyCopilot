// DebugBadge - Floating "Dev" badge shown only in development.
// Double gating layer 1: early return when not DEV so the component body is
// dead code in production builds (combined with the lazy conditional import
// in Layout.tsx this ensures prod bundles never include debug UI).

import { useDebugStore } from '../../store/debugStore'

export default function DebugBadge() {
  // Gating layer 1 — must be the first executable statement.
  if (!import.meta.env.DEV) return null

  const openModal = useDebugStore((s) => s.openModal)

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
