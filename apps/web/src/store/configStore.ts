import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface ConfigStore {
    currentSessionId: string | null;
    currentModelId: string | null;
    authToken: string | null;
    isTokenModalOpen: boolean;
    /** Set when the last token submission failed (invalid token or network error), so the modal can surface an error. */
    tokenError: string | null;
    /** Caller role resolved via /api/auth/me; null until first successful auth. */
    role: 'admin' | 'demo' | null;

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
            role: null,

            setCurrentSessionId: (id) => set({ currentSessionId: id }),
            setCurrentModelId: (id) => set({ currentModelId: id }),
            setAuthToken: (token) => set({ authToken: token }),
            clearAuthToken: () => set({ authToken: null, role: null, isTokenModalOpen: true }),
            submitAuthToken: async (token) => {
                // Validate against /api/auth/me (works for BOTH admin and demo
                // tokens; the old /api/providers probe 403'd demo tokens).
                try {
                    const res = await fetch('/api/auth/me', {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    if (res.ok) {
                        const body = (await res.json()) as { data: { role: 'admin' | 'demo' } };
                        set({ authToken: token, role: body.data.role, isTokenModalOpen: false, tokenError: null });
                    } else if (res.status === 401) {
                        set({ tokenError: '令牌无效，请重试' });
                    } else {
                        set({ tokenError: `验证失败（HTTP ${res.status}），请重试` });
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
