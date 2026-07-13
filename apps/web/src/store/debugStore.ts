// debugStore - Dev-only debug overlay state.
// Manages the DebugModal open/close flag. Intentionally NOT persisted:
// debug state should never survive a page reload or leak into production sessions.

import { create } from 'zustand'

interface DebugState {
  isModalOpen: boolean
  openModal: () => void
  closeModal: () => void
}

export const useDebugStore = create<DebugState>()((set) => ({
  isModalOpen: false,
  openModal: () => set({ isModalOpen: true }),
  closeModal: () => set({ isModalOpen: false }),
}))
