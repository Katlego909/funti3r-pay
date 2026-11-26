import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { api } from './client.js';
import { useAuthStore } from './authStore.js';

const base = '/auth';

/** What every sign-in answers with: the session's account, from the server's database. */
export interface SignedIn {
  accessToken: string;
  userId: string;
  email: string;
  role: string;
  companyId?: string | null;
}

/** Keeps the session the server issued. */
function keep<T extends SignedIn>(data: T): T {
  useAuthStore.getState().setSession(
    { userId: data.userId, email: data.email, role: data.role, companyId: data.companyId ?? undefined },
    data.accessToken,
  );
  return data;
}

/**
 * Creates the account's passkey and signs in. inviteToken / companyInviteToken (if present) are linked server-side in
 * the same request (registerFinishHandler), so a dropped connection cannot leave an invite half accepted.
 */
export async function registerPasskey(email: string, role = 'enterprise', inviteToken?: string, companyInviteToken?: string) {
  const { data: options } = await api.post(`${base}/register/start`, { email, role, origin: window.location.origin });
  const credential = await startRegistration({ optionsJSON: options });
  const { data } = await api.post<SignedIn & { inviteLinked?: boolean; companyInviteLinked?: boolean; companyInviteError?: string }>(
    `${base}/register/finish`,
    { email, credential, origin: window.location.origin, inviteToken, companyInviteToken },
  );
  return keep(data);
}

/** Signs in with the passkey this browser holds for this site. */
export async function loginPasskey(email: string) {
  const { data: options } = await api.post(`${base}/login/start`, { email, origin: window.location.origin });
  const credential = await startAuthentication({ optionsJSON: options });
  const { data } = await api.post<SignedIn>(`${base}/login/finish`, { email, credential, origin: window.location.origin });
  return keep(data);
}

/** DEV ONLY: sign in by email without a passkey (the backend refuses it in production). */
export async function devLogin(email: string) {
  const { data } = await api.post<SignedIn>(`${base}/dev-login`, { email });
  return keep(data);
}

export async function requestRecoveryLink(email: string): Promise<void> {
  await api.post(`${base}/recovery/start`, { email });
}

interface RecoverySession extends SignedIn {
  /** End of the 48h pause on sending and cashing out money that follows an email recovery. */
  moneyHeldUntil: string;
}

export async function verifyRecoveryToken(token: string): Promise<RecoverySession> {
  const { data } = await api.post<RecoverySession>(`${base}/recovery/verify`, { token });
  return keep(data);
}

/** Signs out: ends the server session when it can, and always forgets the local one. */
export async function logout() {
  try {
    await api.post(`${base}/logout`, {});
  } catch {
    // The server session expires on its own; signing out here must not depend on reaching it.
  }
  useAuthStore.getState().clearSession();
}
