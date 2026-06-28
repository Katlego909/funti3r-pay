//! Funti3r-Pay SmartWallet — Soroban contract
//!
//! Each worker receives one deployed instance of this contract.
//! Authentication is entirely controlled by the worker's WebAuthn passkey
//! (P-256 / secp256r1). The platform never holds private keys for workers.
//!
//! Auth flow:
//!   1. Client fetches a Soroban authorization-entry hash (the `signature_payload`).
//!   2. That hash is base64url-encoded and used as the WebAuthn challenge.
//!   3. The authenticator signs: SHA-256(authenticatorData ‖ SHA-256(clientDataJSON)).
//!   4. The client submits { authenticatorData, clientDataJSON, signature } as the
//!      contract's Signature value.
//!   5. `__check_auth` recomputes the same hash and verifies the P-256 signature.

#![no_std]

use soroban_sdk::{
    auth::CustomAccountInterface,
    contract, contractimpl, contracttype,
    crypto::Hash,
    Bytes, BytesN, Env, Symbol, Vec, Context, Address,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Owner,
    CredentialId,
    PasskeyPk, // 65-byte uncompressed SEC1 public key (04 ‖ x ‖ y)
}

// ── Signature type sent by the client ─────────────────────────────────────────

/// The full WebAuthn assertion packed for on-chain verification.
#[contracttype]
pub struct WebAuthnSignature {
    /// Raw authenticatorData bytes from the WebAuthn response.
    pub authenticator_data: Bytes,
    /// UTF-8 bytes of the clientDataJSON string from the WebAuthn response.
    pub client_data_json: Bytes,
    /// Compact 64-byte P-256 ECDSA signature (r ‖ s).
    pub signature: BytesN<64>,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct SmartWallet;

#[contractimpl]
impl SmartWallet {
    /// Deploy-time initialisation — called exactly once by the platform operator
    /// immediately after contract deployment.
    ///
    /// * `owner`        – The Stellar address of the contract itself (used as the
    ///                    account address for Soroban auth purposes).
    /// * `credential_id`– The WebAuthn credential ID (raw bytes, not base64).
    /// * `passkey_pk`   – Uncompressed SEC1 P-256 public key (65 bytes: 04 ‖ x ‖ y).
    pub fn init(
        env: Env,
        owner: Address,
        credential_id: Bytes,
        passkey_pk: BytesN<65>,
    ) {
        if env.storage().instance().has(&DataKey::Owner) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::CredentialId, &credential_id);
        env.storage().instance().set(&DataKey::PasskeyPk, &passkey_pk);
    }

    /// Returns the owner address stored at init time.
    pub fn owner(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Owner)
            .expect("not initialized")
    }

    /// Returns the stored WebAuthn credential ID.
    pub fn credential_id(env: Env) -> Bytes {
        env.storage()
            .instance()
            .get(&DataKey::CredentialId)
            .expect("not initialized")
    }
}

// ── CustomAccountInterface ────────────────────────────────────────────────────

#[contractimpl]
impl CustomAccountInterface for SmartWallet {
    type Signature = WebAuthnSignature;
    type Error = Symbol;

    /// Verifies that the WebAuthn assertion was produced by the passkey whose
    /// public key is stored in this contract instance.
    ///
    /// Verification steps:
    ///   1. `cd_hash`  = SHA-256(clientDataJSON)
    ///   2. `msg`      = authenticatorData ‖ cd_hash
    ///   3. `msg_hash` = SHA-256(msg)
    ///   4. secp256r1_verify(passkey_pk, msg_hash, compact_signature)
    fn __check_auth(
        env: Env,
        _signature_payload: Hash<32>,
        sig: WebAuthnSignature,
        _auth_contexts: Vec<Context>,
    ) -> Result<(), Self::Error> {
        // Step 1: hash the clientDataJSON
        let cd_hash: BytesN<32> = env.crypto().sha256(&sig.client_data_json);

        // Step 2: authenticatorData ‖ SHA-256(clientDataJSON)
        let cd_hash_bytes = Bytes::from_array(&env, &cd_hash.to_array());
        let mut msg = sig.authenticator_data.clone();
        msg.append(&cd_hash_bytes);

        // Step 3: hash the concatenated message
        let msg_hash: BytesN<32> = env.crypto().sha256(&msg);

        // Step 4: retrieve public key and verify signature
        //
        // `secp256r1_verify` panics on invalid signatures; the Soroban host
        // surfaces this as an auth failure to the caller.
        let pk: BytesN<65> = env
            .storage()
            .instance()
            .get(&DataKey::PasskeyPk)
            .ok_or(Symbol::new(&env, "NoPubKey"))?;

        env.crypto().secp256r1_verify(&pk, &msg_hash, &sig.signature);

        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_init_and_getters() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SmartWallet);
        let client = SmartWalletClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let cred_id = Bytes::from_slice(&env, b"test-credential-id");
        // 65-byte zeroed public key (not a valid P-256 key, only used to test storage)
        let pk = BytesN::from_array(&env, &[0u8; 65]);

        client.init(&owner, &cred_id, &pk);

        assert_eq!(client.owner(), owner);
        assert_eq!(client.credential_id(), cred_id);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_init_panics() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SmartWallet);
        let client = SmartWalletClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let cred_id = Bytes::from_slice(&env, b"cred");
        let pk = BytesN::from_array(&env, &[0u8; 65]);

        client.init(&owner, &cred_id, &pk);
        client.init(&owner, &cred_id, &pk); // should panic
    }
}
