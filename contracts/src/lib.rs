// Soroban Smart Contracts for Funti3r-pay
// Multi-party escrow and Smart Wallet contract

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, log, Env, Symbol, Address, BytesN, Vec, Context, Result};
use soroban_sdk::auth::CustomAccountInterface;
use p256::ecdsa::{Signature, VerifyingKey, signature::Verifier};

#[contracttype]
pub enum DataKey {
    Owner,
    PasskeyPublicKey,
}

#[contract]
pub struct SmartWallet;

#[contractimpl]
impl SmartWallet {
    pub fn init(env: Env, owner: Address, passkey_public_key: BytesN<64>) {
        if env.storage().instance().has(&DataKey::Owner) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::PasskeyPublicKey, &passkey_public_key);
    }
}

#[contractimpl]
impl CustomAccountInterface for SmartWallet {
    type Signature = BytesN<64>; // Expecting 64-byte ECDSA signature
    type Error = Symbol;

    fn __check_auth(
        env: Env,
        signature_payload: soroban_sdk::Hash<32>,
        signature: Self::Signature,
        _auth_contexts: Vec<Context>,
    ) -> Result<(), Self::Error> {
        let pk_bytes: BytesN<64> = env.storage().instance().get(&DataKey::PasskeyPublicKey).unwrap();
        
        let verifying_key = VerifyingKey::from_sec1_bytes(&pk_bytes.to_array()).map_err(|_| Symbol::new(&env, "InvalidPK"))?;
        let sig = Signature::from_slice(&signature.to_array()).map_err(|_| Symbol::new(&env, "InvalidSig"))?;

        verifying_key.verify(signature_payload.as_slice(), &sig).map_err(|_| Symbol::new(&env, "AuthFailed"))?;

        log!(&env, "Authentication success");
        Ok(())
    }
}
