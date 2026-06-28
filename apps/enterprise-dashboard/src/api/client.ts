import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // send httpOnly refresh_token cookie
});

// Attach access token to every request
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
        .post<{ accessToken: string }>('/api/auth/refresh', {}, { withCredentials: true })
        .then((r) => {
          sessionStorage.setItem('access_token', r.data.accessToken);
          return r.data.accessToken;
        })
        .finally(() => { refreshing = null; });
    }

    const token = await refreshing;
    original.headers.Authorization = `Bearer ${token}`;
    return api(original);
  },
);
