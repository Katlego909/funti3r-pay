import {
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser';
import { api } from './client.js';
import { useAuthStore } from '../store/authStore.js';

const base = '/auth';

export async function registerPasskey(email: string, role = 'enterprise') {
  try {
    // 1. Get options from server
    console.log('[WebAuthn] Requesting registration options...');
    const { data: options } = await api.post(`${base}/register/start`, { email, role, origin: window.location.origin });
    console.log('[WebAuthn] Registration options received:', options);

    // 2. Browser prompts user to create passkey
    console.log('[WebAuthn] Auth payload sent to startRegistration:', options);
    const registrationResponse = await startRegistration(options);
    console.log('[WebAuthn] Registration response received:', registrationResponse);
    console.log('[WebAuthn] Credential created:', registrationResponse.id);

    // 3. Verify with server and receive JWT
    console.log('[WebAuthn] Verifying credential with server...');
    const { data } = await api.post<{
      accessToken: string;
      userId: string;
      email: string;
      role: string;
    }>(`${base}/register/finish`, { email, credential: registrationResponse, origin: window.location.origin });

    useAuthStore.getState().setSession(
      { userId: data.userId, email: data.email, role: data.role },
      data.accessToken,
    );
    console.log('[WebAuthn] Registration successful:', data.userId);
    return data;
  } catch (err) {
    console.error('[WebAuthn] Registration error:', err);
    throw err;
  }
}

export async function loginPasskey(email: string) {
  try {
    // 1. Get authentication options
    console.log('[WebAuthn] Requesting authentication options...');
    const { data: options } = await api.post(`${base}/login/start`, { email, origin: window.location.origin });
    console.log('[WebAuthn] Authentication options received:', options);

    // 2. Browser prompts user to sign with passkey
    console.log('[WebAuthn] Auth payload sent to startAuthentication:', options);
    const authenticationResponse = await startAuthentication(options);
    console.log('[WebAuthn] Authentication response received:', authenticationResponse);

    // 3. Verify and receive JWT
    console.log('[WebAuthn] Verifying credential with server...');
    const { data } = await api.post<{
      accessToken: string;
      userId: string;
      email: string;
      role: string;
    }>(`${base}/login/finish`, { email, credential: authenticationResponse, origin: window.location.origin });

    useAuthStore.getState().setSession(
      { userId: data.userId, email: data.email, role: data.role },
      data.accessToken,
    );
    console.log('[WebAuthn] Login successful:', data.userId);
    return data;
  } catch (err) {
    console.error('[WebAuthn] Login error:', err);
    throw err;
  }
}

export async function logout() {
  try {
    await api.post(`${base}/logout`, {});
  } catch (err) {
    console.error('[WebAuthn] Logout error:', err);
  }
  useAuthStore.getState().clearSession();
}
