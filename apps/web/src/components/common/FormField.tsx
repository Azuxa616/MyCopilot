// FormField - Shared label + control + error layout for form modals.
// Eliminates the repeated label/input/error-span + long className pattern across form modals.

import type { ReactNode } from 'react'

/** Shared input/select className used by all form controls in modals. */
export const formControlClassName =
  'w-full px-3 py-2 text-sm text-text-primary bg-bg-elevated border border-border-base rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all placeholder:text-text-tertiary'

export interface FormFieldProps {
  /** Label text. Pass `required` to show the red asterisk. */
  label: string
  required?: boolean
  /** Validation error message; rendered in red below the control when present. */
  error?: string
  /** The control element (input, select, etc.). FormField does NOT clone it — pass a ready element. */
  children: ReactNode
}

/**
 * Lays out a form field: label (with optional asterisk) → control → error message.
 * The caller retains full control over the input element (value, onChange, type, ...).
 */
export function FormField({ label, required, error, children }: FormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-text-primary">
        {label} {required && <span className="text-error-500">*</span>}
      </label>
      {children}
      {error && <span className="text-xs text-error-500">{error}</span>}
    </div>
  )
}
