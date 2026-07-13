// DebugModal - Dev-only diagnostic overlay with 5 placeholder sections.
// Double gating layer 1: early return when not DEV.
// Section content is filled by T6/T7/T8; this file only ships the skeleton.

import Modal from '../common/Modal'
import { useDebugStore } from '../../store/debugStore'

export default function DebugModal() {
  // Gating layer 1 — must be the first executable statement.
  if (!import.meta.env.DEV) return null

  const isModalOpen = useDebugStore((s) => s.isModalOpen)
  const closeModal = useDebugStore((s) => s.closeModal)

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
        {/* Section 1 — filled by T6 */}
        <section>
          <h4 className="text-sm font-semibold text-text-primary mb-1.5">
            Git &amp; Environment
          </h4>
          <p className="text-xs text-text-tertiary">
            Version, commit, and build environment details.
          </p>
        </section>

        <hr className="border-border-base" />

        {/* Section 2 — filled by T6 */}
        <section>
          <h4 className="text-sm font-semibold text-text-primary mb-1.5">
            API Configuration
          </h4>
          <p className="text-xs text-text-tertiary">
            Active provider, model, endpoint, and auth status.
          </p>
        </section>

        <hr className="border-border-base" />

        {/* Section 3 — filled by T7 */}
        <section>
          <h4 className="text-sm font-semibold text-text-primary mb-1.5">
            Store Snapshot
          </h4>
          <p className="text-xs text-text-tertiary">
            Serialized Zustand store state for debugging.
          </p>
        </section>

        <hr className="border-border-base" />

        {/* Section 4 — filled by T7 */}
        <section>
          <h4 className="text-sm font-semibold text-text-primary mb-1.5">
            Backend Runtime
          </h4>
          <p className="text-xs text-text-tertiary">
            Server health, database, and job worker status.
          </p>
        </section>

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
