// ApiConfigSection - Debug modal section 2.
// Shows configStore state as key-value pairs. Auth token is NEVER shown
// in plaintext — only its presence ("Set" / "Not set") via Boolean(authToken).

import { useConfigStore } from '../../../store/configStore'

interface Row {
  label: string
  value: string
}

export default function ApiConfigSection() {
  // Subscribe to individual fields so the panel stays reactive while open.
  const authToken = useConfigStore((s) => s.authToken)
  const currentModelId = useConfigStore((s) => s.currentModelId)
  const currentSessionId = useConfigStore((s) => s.currentSessionId)
  const tokenError = useConfigStore((s) => s.tokenError)

  // Curated rows — authToken is reduced to a boolean status, never plaintext.
  const rows: Row[] = [
    { label: 'Auth Token', value: authToken ? 'Set' : 'Not set' },
    { label: 'Current Model', value: currentModelId ?? 'none' },
    { label: 'Current Session', value: currentSessionId ?? 'none' },
    { label: 'Token Error', value: tokenError ?? '—' },
  ]

  return (
    <section data-testid="api-config-section">
      <h4 className="text-sm font-semibold text-text-primary mb-1.5">
        API Configuration
      </h4>
      <dl className="font-mono text-xs space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex gap-2">
            <dt className="text-text-secondary shrink-0">{row.label}:</dt>
            <dd className="text-text-primary break-all">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
