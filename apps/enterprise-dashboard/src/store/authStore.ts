import { create } from 'zustand';

interface AuthUser {
  userId: string;
  email: string;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  setSession: (user: AuthUser, token: string) => void;
  clearSession: () => void;
  initializeFromStorage: () => void;
}

const getStoredToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('access_token');
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: getStoredToken(),

  initializeFromStorage: () => {
    const token = getStoredToken();
    if (token) {
      set({ accessToken: token });
    }
  },

  setSession: (user, token) => {
    sessionStorage.setItem('access_token', token);
    set({ user, accessToken: token });
    console.log('[AuthStore] Session set:', { userId: user.userId, email: user.email, token: token.substring(0, 20) + '...' });
  },

  clearSession: () => {
    sessionStorage.removeItem('access_token');
    set({ user: null, accessToken: null });
    console.log('[AuthStore] Session cleared');
  },
}));
