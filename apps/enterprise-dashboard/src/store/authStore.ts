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

const getStoredUser = (): AuthUser | null => {
  if (typeof window === 'undefined') return null;
  const stored = sessionStorage.getItem('auth_user');
  return stored ? JSON.parse(stored) : null;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: getStoredUser(),
  accessToken: getStoredToken(),

  initializeFromStorage: () => {
    const token = getStoredToken();
    const user = getStoredUser();
    if (token || user) {
      set({ accessToken: token, user });
    }
  },

  setSession: (user, token) => {
    sessionStorage.setItem('access_token', token);
    sessionStorage.setItem('auth_user', JSON.stringify(user));
    set({ user, accessToken: token });
    console.log('[AuthStore] Session set:', { userId: user.userId, email: user.email, token: token.substring(0, 20) + '...' });
  },

  clearSession: () => {
    sessionStorage.removeItem('access_token');
    sessionStorage.removeItem('auth_user');
    set({ user: null, accessToken: null });
    console.log('[AuthStore] Session cleared');
  },
}));
