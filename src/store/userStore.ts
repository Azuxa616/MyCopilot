import { create } from 'zustand';
import type { User } from '../types/user';
interface UserStore {
  user: User | null;
  setUser: (user: User) => void;
  updateUser: (updates: Partial<User>) => void;
  clearUser: () => void;
}

const defaultUser: User = {
  username: 'Azuxa616',
  email: 'azuxa616@gmail.com', 
  avatarUrl: 'https://avatars.githubusercontent.com/u/123456789?v=4',
};

export const useUserStore = create<UserStore>()(

    (set) => ({
      user: defaultUser,

      setUser: (user) => set({ user }),

      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),

      clearUser: () => set({ user: null }),
    })
);
