import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface ConfigStore {
    currentSessionId: string | null;
    currentModelId: string | null;
    authToken: string | null;
    isTokenModalOpen: boolean;
    /** Set when the last token submission failed (invalid token or network error), so the modal can surface an error. */
    tokenError: string | null;

    setCurrentSessionId: (id: string | null) => void;
    setCurrentModelId: (id: string | null) => void;
    setAuthToken: (token: string | null) => void;
    clearAuthToken: () => void;
    submitAuthToken: (token: string) => Promise<void>;
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set) => ({
            currentSessionId: null,
            currentModelId: null,
            authToken: null,
            isTokenModalOpen: false,
            tokenError: null,

            setCurrentSessionId: (id) => set({ currentSessionId: id }),
            setCurrentModelId: (id) => set({ currentModelId: id }),
            setAuthToken: (token) => set({ authToken: token }),
            clearAuthToken: () => set({ authToken: null, isTokenModalOpen: true }),
            submitAuthToken: async (token) => {
                // Validate token against server before accepting.
                // On failure, do NOT clobber an already-valid token: the user may be re-submitting
                // from the ProvidersPage while a working token is already in place.
                try {
                    const res = await fetch('/api/providers', {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    if (res.ok) {
                        set({ authToken: token, isTokenModalOpen: false, tokenError: null });
                    } else {
                        // Invalid token — keep existing token (if any) intact, only flag the error.
                        set({ tokenError: '令牌无效，请重试' });
                    }
                } catch {
                    // Network error — preserve existing token, surface a network-specific message.
                    set({ tokenError: '网络错误，无法验证令牌' });
                }
            },
        }),
        {
            name: 'mycopilot-config',
            storage: createJSONStorage(() => localStorage),
        }
    )
);
