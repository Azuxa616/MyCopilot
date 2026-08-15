// DebugModal - Dev-only diagnostic overlay with 5 placeholder sections.
// Double gating layer 1: early return when not DEV.
// Section content is filled by T6/T7/T8; this file only ships the skeleton.

import Modal from '../common/Modal'
import { useDebugStore } from '../../store/debugStore'
import GitEnvSection from './sections/GitEnvSection'
import ApiConfigSection from './sections/ApiConfigSection'
import StoreSnapshotSection from './sections/StoreSnapshotSection'
import BackendRuntimeSection from './sections/BackendRuntimeSection'

export default function DebugModal() {
  // Hooks must run unconditionally (rules-of-hooks); the store subscriptions
  // are cheap and the component is never imported in prod (gating layer 2).
  const isModalOpen = useDebugStore((s) => s.isModalOpen)
  const closeModal = useDebugStore((s) => s.closeModal)

  // Gating layer 1 — render nothing in production builds.
  if (!import.meta.env.DEV) return null

  return (
    <Modal
      open={isModalOpen}
      onOpenChange={(open) => {
        if (!open) closeModal()
      }}
      title="Debug Information"
      width="640px"
    >
      <div data-testid="debug-modal" className="flex flex-col gap-5">
        {/* Section 1 — Git & Environment (filled by T6) */}
        <GitEnvSection />

        <hr className="border-border-base" />

        {/* Section 2 — API Configuration */}
        <ApiConfigSection />

        <hr className="border-border-base" />

        {/* Section 3 — Store Snapshot */}
        <StoreSnapshotSection />

        <hr className="border-border-base" />

        {/* Section 4 — filled by T8 */}
        <BackendRuntimeSection />

        <hr className="border-border-base" />

        {/* Section 5 — filled by T8 */}
        <section>
          <h4 className="text-sm font-semibold text-text-primary mb-1.5">
            Tool Calls Info
          </h4>
          <p className="text-xs text-text-tertiary">
            Recent tool invocations and safety policy decisions.
          </p>
        </section>

        {/* Footer */}
        <div className="flex justify-end pt-2 border-t border-border-base">
          <button
            type="button"
            onClick={closeModal}
            className="px-4 py-2 text-sm text-text-primary bg-bg-secondary border border-border-base rounded-lg hover:bg-bg-hover transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
