// Simple WebAuthn wrapper for Passkeys
// NOTE: This assumes standard WebAuthn API (navigator.credentials)

export async function registerPasskey(userId: string, challenge: Uint8Array): Promise<PublicKeyCredential> {
  const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
    challenge: challenge,
    rp: {
      name: "Funti3r-pay",
      id: window.location.hostname,
    },
    user: {
      id: new TextEncoder().encode(userId),
      name: userId,
      displayName: userId,
    },
    pubKeyCredParams: [{ alg: -7, type: "public-key" }], // ECDSA P-256
    authenticatorSelection: {
      userVerification: "required",
    },
    timeout: 60000,
  };

  return await navigator.credentials.create({
    publicKey: publicKeyCredentialCreationOptions,
  }) as PublicKeyCredential;
}

export async function signTransaction(challenge: Uint8Array, credentialId: string): Promise<PublicKeyCredential> {
  const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
    challenge: challenge,
    allowCredentials: [{
      id: new TextEncoder().encode(credentialId),
      type: 'public-key',
    }],
    userVerification: "required",
    timeout: 60000,
  };

  return await navigator.credentials.get({
    publicKey: publicKeyCredentialRequestOptions,
  }) as PublicKeyCredential;
}
