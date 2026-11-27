import { create } from 'zustand';

interface AuthUser {
  userId: string;
  email: string;
  role: string;
  companyId?: string;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  setSession: (user: AuthUser, token: string) => void;
  clearSession: () => void;
  initializeFromStorage: () => void;
}

const TOKEN_KEY = 'access_token';

/**
 * The account an access token was issued to, read from its payload. The signed-in user is always taken from the token
 * the app will send, never kept apart from it, so the app can't show one account while acting as another (as happened
 * when a refresh swapped the token but not the stored user). Only for display: the server checks the signature and the
 * account's role and status on every request.
 */
export function userFromToken(token: string | null): AuthUser | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.userId !== 'string' || typeof payload.role !== 'string') return null;
    return { userId: payload.userId, email: payload.email, role: payload.role, companyId: payload.companyId ?? undefined };
  } catch {
    return null;
  }
}

const getStoredToken = (): string | null => (typeof window === 'undefined' ? null : sessionStorage.getItem(TOKEN_KEY));

export const useAuthStore = create<AuthState>((set) => ({
  user: userFromToken(getStoredToken()),
  accessToken: getStoredToken(),

  initializeFromStorage: () => {
    const token = getStoredToken();
    set({ accessToken: token, user: userFromToken(token) });
  },

  setSession: (user, token) => {
    sessionStorage.setItem(TOKEN_KEY, token);
    set({ accessToken: token, user: userFromToken(token) ?? user });
  },

  clearSession: () => {
    sessionStorage.removeItem(TOKEN_KEY);
    set({ user: null, accessToken: null });
  },
}));
