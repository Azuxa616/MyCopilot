// Badge - Small pill-style status/type badges shared across settings pages.
// Eliminates the repeated inline <span className={...}> badge markup in ProvidersPage and ProviderDetailPage.

import type { ReactNode } from 'react'

export interface BadgeProps {
  children: ReactNode
  /** Tailwind background + text color classes, e.g. 'bg-green-100 text-green-700'. */
  colorClass: string
}

/** Generic pill badge. The caller picks the color via `colorClass`. */
export function Badge({ children, colorClass }: BadgeProps) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colorClass}`}>
      {children}
    </span>
  )
}

/** Provider type badge (openai → blue, ollama → emerald). */
export function ProviderTypeBadge({ type }: { type: 'openai' | 'ollama' }) {
  return (
    <Badge colorClass={type === 'openai' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}>
      {type}
    </Badge>
  )
}

/** Enabled/disabled status badge (green when enabled, gray when disabled). */
export function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge colorClass={enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}>
      {enabled ? '启用' : '禁用'}
    </Badge>
  )
}
