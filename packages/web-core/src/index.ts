/**
 * What every Funti3rPay web app shares to talk to the platform: the API client (token, single-flight refresh), the
 * signed-in session, sign-in and sign-out, and turning a failed call into a message.
 */
export { api } from './client.js';
export { apiErrorMessage } from './errors.js';
export { useAuthStore } from './authStore.js';
export {
  devLogin,
  loginPasskey,
  logout,
  registerPasskey,
  requestRecoveryLink,
  verifyRecoveryToken,
  type SignedIn,
} from './auth.js';
