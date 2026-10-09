import axios from 'axios';
import { useAuthStore } from '../store/authStore.js';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // send httpOnly refresh_token cookie
});

// Attach access token to every request (browser sends Origin automatically)
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401 try to refresh, then retry once
let refreshing: Promise<string> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (err.response?.status !== 401 || original._retry) throw err;

    original._retry = true;

    if (!refreshing) {
      refreshing = axios
        .post<{ accessToken: string }>(`${BASE_URL}/api/auth/refresh`, {}, { withCredentials: true })
        .then((r) => {
          sessionStorage.setItem('access_token', r.data.accessToken);
          return r.data.accessToken;
        })
        .finally(() => { refreshing = null; });
    }

    let token: string;
    try {
      token = await refreshing;
    } catch {
      // The session can't be renewed: drop it so ProtectedRoute sends the user to /login.
      useAuthStore.getState().clearSession();
      throw err;
    }
    original.headers.Authorization = `Bearer ${token}`;
    return api(original);
  },
);
