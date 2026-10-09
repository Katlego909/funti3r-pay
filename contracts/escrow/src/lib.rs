//! Funti3r milestone escrow with an on-chain compliance gate.
//!
//! An enterprise funds an escrow for a worker with N milestone tranches of a
//! SAC token (native XLM on testnet, USDC on mainnet — same code). Flow:
//!
//!   create (enterprise deposits total; worker must be cleared)
//!     └─ per milestone: Pending ──approve(enterprise)──► Approved ──claim(worker)──► Claimed
//!   refund (enterprise, only after expiry): every still-Pending tranche is
//!   returned; Approved tranches stay claimable — the worker earned them.
//!
//! Compliance gate: a dedicated `compliance` authority (the platform's
//! KYC/AML screening service, a different key from any enterprise or worker)
//! records a time-boxed clearance per worker, bound to the hash of the
//! screening record that justified it. create/approve/claim all fail unless
//! the worker holds a live clearance, and the authority can `freeze` a single
//! escrow (e.g. a sanctions hit mid-flight) which blocks every movement of
//! its funds until unfrozen.
//!
//! Escrow status: Active ─► Completed (≥1 claimed, nothing open)
//!                        └► Refunded (nothing claimed, nothing open)
#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, BytesN,
    ContractExecutable,
    Env, Vec,
};

// ~1 day threshold / ~30 day extension, in ledgers (~5s each).
const TTL_THRESHOLD: u32 = 17_280;
const TTL_EXTEND_TO: u32 = 518_400;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MilestoneStatus {
    Pending,
    Approved,
    Claimed,
    Refunded,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EscrowStatus {
    Active,
    Completed,
    Refunded,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Escrow {
    pub enterprise: Address,
    pub worker: Address,
    pub token: Address,
    pub amounts: Vec<i128>,
    pub milestones: Vec<MilestoneStatus>,
    pub expiry: u64,
    pub status: EscrowStatus,
    pub frozen: bool,
}

/// A worker's compliance clearance: valid until `expiry` (unix seconds) and
/// bound to the hash of the off-chain screening record behind it.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Clearance {
    pub expiry: u64,
    pub attestation: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Compliance,
    NextId,
    Escrow(u64),
    Clearance(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    EscrowNotFound = 1,
    NoMilestones = 2,
    InvalidAmount = 3,
    InvalidExpiry = 4,
    EscrowNotActive = 5,
    MilestoneOutOfBounds = 6,
    MilestoneNotPending = 7,
    MilestoneNotApproved = 8,
    NotExpired = 9,
    NothingToRefund = 10,
    NotCleared = 11,
    EscrowFrozen = 12,
    InvalidClearance = 13,
    NotFrozen = 14,
}

// ── Events ───────────────────────────────────────────────────────────────────

#[contractevent]
pub struct Created {
    #[topic]
    pub id: u64,
    pub enterprise: Address,
    pub worker: Address,
    pub total: i128,
}

#[contractevent]
pub struct Approved {
    #[topic]
    pub id: u64,
    pub idx: u32,
}

#[contractevent]
pub struct Claimed {
    #[topic]
    pub id: u64,
    pub idx: u32,
    pub amount: i128,
}

#[contractevent]
pub struct Refunded {
    #[topic]
    pub id: u64,
    pub total: i128,
}

#[contractevent]
pub struct ReturnedToEnterprise {
    #[topic]
    pub id: u64,
    pub total: i128,
}

#[contractevent]
pub struct ClearanceSet {
    #[topic]
    pub worker: Address,
    pub expiry: u64,
    pub attestation: BytesN<32>,
}

#[contractevent]
pub struct ClearanceRevoked {
    #[topic]
    pub worker: Address,
}

#[contractevent]
pub struct FreezeChanged {
    #[topic]
    pub id: u64,
    pub frozen: bool,
}

// ── Storage helpers ──────────────────────────────────────────────────────────

fn load(env: &Env, id: u64) -> Result<Escrow, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Escrow(id))
        .ok_or(Error::EscrowNotFound)
}

fn save(env: &Env, id: u64, escrow: &Escrow) {
    let key = DataKey::Escrow(id);
    env.storage().persistent().set(&key, escrow);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn compliance_authority(env: &Env) -> Address {
    // Set by the constructor, so always present on a deployed contract.
    env.storage()
        .instance()
        .get(&DataKey::Compliance)
        .expect("constructor sets compliance")
}

fn admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("constructor sets admin")
}

fn is_cleared(env: &Env, worker: &Address) -> bool {
    let clearance: Option<Clearance> = env
        .storage()
        .persistent()
        .get(&DataKey::Clearance(worker.clone()));
    matches!(clearance, Some(c) if c.expiry > env.ledger().timestamp())
}

fn require_cleared(env: &Env, worker: &Address) -> Result<(), Error> {
    if is_cleared(env, worker) {
        Ok(())
    } else {
        Err(Error::NotCleared)
    }
}

/// When no milestone is Pending or Approved anymore, the escrow is final:
/// Completed if the worker claimed at least one tranche, else Refunded.
fn finalize_status(escrow: &mut Escrow) {
    let mut open = false;
    let mut claimed = false;
    for m in escrow.milestones.iter() {
        match m {
            MilestoneStatus::Pending | MilestoneStatus::Approved => open = true,
            MilestoneStatus::Claimed => claimed = true,
            MilestoneStatus::Refunded => {}
        }
    }
    if !open {
        escrow.status = if claimed {
            EscrowStatus::Completed
        } else {
            EscrowStatus::Refunded
        };
    }
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Runs once, atomically, at deploy time. `admin` can rotate the
    /// compliance authority and upgrade the code; `compliance` grants and
    /// revokes worker clearances and freezes escrows.
    pub fn __constructor(env: Env, admin: Address, compliance: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::Compliance, &compliance);
        bump_instance(&env);
    }

    // ── Administration ───────────────────────────────────────────────────────

    pub fn set_compliance(env: Env, new_compliance: Address) {
        admin(&env).require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Compliance, &new_compliance);
        bump_instance(&env);
    }

    /// Swap the contract code (upload the new wasm first, pass its hash).
    /// Address and storage survive; the constructor does not re-run.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        admin(&env).require_auth();
        env.deployer().update_current_contract(ContractExecutable::Wasm(new_wasm_hash));
    }

    // ── Compliance ───────────────────────────────────────────────────────────

    /// Compliance authority clears `worker` until `expiry`, recording the hash
    /// of the screening record that justifies it.
    pub fn set_clearance(
        env: Env,
        worker: Address,
        expiry: u64,
        attestation: BytesN<32>,
    ) -> Result<(), Error> {
        compliance_authority(&env).require_auth();
        if expiry <= env.ledger().timestamp() {
            return Err(Error::InvalidClearance);
        }
        let key = DataKey::Clearance(worker.clone());
        env.storage().persistent().set(
            &key,
            &Clearance {
                expiry,
                attestation: attestation.clone(),
            },
        );
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        bump_instance(&env);

        ClearanceSet {
            worker,
            expiry,
            attestation,
        }
        .publish(&env);
        Ok(())
    }

    /// Immediately removes a worker's clearance (e.g. a new sanctions hit).
    pub fn revoke_clearance(env: Env, worker: Address) {
        compliance_authority(&env).require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::Clearance(worker.clone()));
        ClearanceRevoked { worker }.publish(&env);
    }

    /// Compliance hold on a single escrow: while frozen, no milestone can be
    /// approved or claimed and nothing can be refunded.
    pub fn set_frozen(env: Env, id: u64, frozen: bool) -> Result<(), Error> {
        compliance_authority(&env).require_auth();
        let mut escrow = load(&env, id)?;
        escrow.frozen = frozen;
        save(&env, id, &escrow);
        FreezeChanged { id, frozen }.publish(&env);
        Ok(())
    }

    /// Resolves a frozen escrow whose hold was upheld (e.g. a confirmed
    /// sanctions hit): every tranche the worker has not yet claimed, pending
    /// or approved, goes back to the enterprise. Only the compliance authority
    /// can do this, and only while the escrow is frozen, so a worker's
    /// earned tranche is never taken without an explicit compliance freeze.
    pub fn return_frozen(env: Env, id: u64) -> Result<i128, Error> {
        compliance_authority(&env).require_auth();
        let mut escrow = load(&env, id)?;

        if escrow.status != EscrowStatus::Active {
            return Err(Error::EscrowNotActive);
        }
        if !escrow.frozen {
            return Err(Error::NotFrozen);
        }

        let mut total: i128 = 0;
        for idx in 0..escrow.milestones.len() {
            match escrow.milestones.get(idx) {
                Some(MilestoneStatus::Pending) | Some(MilestoneStatus::Approved) => {
                    total += escrow.amounts.get(idx).ok_or(Error::MilestoneOutOfBounds)?;
                    escrow.milestones.set(idx, MilestoneStatus::Refunded);
                }
                _ => {}
            }
        }
        if total == 0 {
            return Err(Error::NothingToRefund);
        }

        finalize_status(&mut escrow);
        save(&env, id, &escrow);

        token::Client::new(&env, &escrow.token).transfer(
            &env.current_contract_address(),
            &escrow.enterprise,
            &total,
        );

        ReturnedToEnterprise { id, total }.publish(&env);
        Ok(total)
    }

    pub fn is_cleared(env: Env, worker: Address) -> bool {
        is_cleared(&env, &worker)
    }

    pub fn get_clearance(env: Env, worker: Address) -> Option<Clearance> {
        env.storage().persistent().get(&DataKey::Clearance(worker))
    }

    // ── Escrow lifecycle ─────────────────────────────────────────────────────

    /// Enterprise funds a new escrow: transfers the sum of `amounts` into the
    /// contract and returns the escrow id. The worker must hold a clearance.
    pub fn create(
        env: Env,
        enterprise: Address,
        worker: Address,
        token: Address,
        amounts: Vec<i128>,
        expiry: u64,
    ) -> Result<u64, Error> {
        enterprise.require_auth();
        require_cleared(&env, &worker)?;

        if amounts.is_empty() {
            return Err(Error::NoMilestones);
        }
        let mut total: i128 = 0;
        for a in amounts.iter() {
            if a <= 0 {
                return Err(Error::InvalidAmount);
            }
            total = total.checked_add(a).ok_or(Error::InvalidAmount)?;
        }
        if expiry <= env.ledger().timestamp() {
            return Err(Error::InvalidExpiry);
        }

        token::Client::new(&env, &token).transfer(
            &enterprise,
            &env.current_contract_address(),
            &total,
        );

        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));
        bump_instance(&env);

        let mut milestones = Vec::new(&env);
        for _ in 0..amounts.len() {
            milestones.push_back(MilestoneStatus::Pending);
        }

        let escrow = Escrow {
            enterprise: enterprise.clone(),
            worker: worker.clone(),
            token,
            amounts,
            milestones,
            expiry,
            status: EscrowStatus::Active,
            frozen: false,
        };
        save(&env, id, &escrow);

        Created {
            id,
            enterprise,
            worker,
            total,
        }
        .publish(&env);
        Ok(id)
    }

    /// Enterprise marks a milestone as approved — the worker may then claim it.
    pub fn approve(env: Env, id: u64, idx: u32) -> Result<(), Error> {
        let mut escrow = load(&env, id)?;
        escrow.enterprise.require_auth();

        if escrow.status != EscrowStatus::Active {
            return Err(Error::EscrowNotActive);
        }
        if escrow.frozen {
            return Err(Error::EscrowFrozen);
        }
        require_cleared(&env, &escrow.worker)?;
        match escrow.milestones.get(idx) {
            None => return Err(Error::MilestoneOutOfBounds),
            Some(MilestoneStatus::Pending) => {}
            Some(_) => return Err(Error::MilestoneNotPending),
        }
        escrow.milestones.set(idx, MilestoneStatus::Approved);
        save(&env, id, &escrow);

        Approved { id, idx }.publish(&env);
        Ok(())
    }

    /// Worker claims an approved milestone — the tranche is paid out.
    /// Deliberately NOT gated on expiry: an approved tranche is earned. It IS
    /// gated on a live clearance and on the escrow not being frozen.
    pub fn claim(env: Env, id: u64, idx: u32) -> Result<(), Error> {
        let mut escrow = load(&env, id)?;
        escrow.worker.require_auth();

        if escrow.status != EscrowStatus::Active {
            return Err(Error::EscrowNotActive);
        }
        if escrow.frozen {
            return Err(Error::EscrowFrozen);
        }
        require_cleared(&env, &escrow.worker)?;
        match escrow.milestones.get(idx) {
            None => return Err(Error::MilestoneOutOfBounds),
            Some(MilestoneStatus::Approved) => {}
            Some(_) => return Err(Error::MilestoneNotApproved),
        }
        let amount = escrow.amounts.get(idx).ok_or(Error::MilestoneOutOfBounds)?;

        escrow.milestones.set(idx, MilestoneStatus::Claimed);
        finalize_status(&mut escrow);
        save(&env, id, &escrow);

        token::Client::new(&env, &escrow.token).transfer(
            &env.current_contract_address(),
            &escrow.worker,
            &amount,
        );

        Claimed { id, idx, amount }.publish(&env);
        Ok(())
    }

    /// After expiry the enterprise can pull back every still-Pending tranche.
    /// Approved tranches are untouched — the worker can still claim them.
    pub fn refund(env: Env, id: u64) -> Result<i128, Error> {
        let mut escrow = load(&env, id)?;
        escrow.enterprise.require_auth();

        if escrow.status != EscrowStatus::Active {
            return Err(Error::EscrowNotActive);
        }
        if escrow.frozen {
            return Err(Error::EscrowFrozen);
        }
        if env.ledger().timestamp() <= escrow.expiry {
            return Err(Error::NotExpired);
        }

        let mut total: i128 = 0;
        for idx in 0..escrow.milestones.len() {
            if escrow.milestones.get(idx) == Some(MilestoneStatus::Pending) {
                // amounts and milestones are created with identical length
                total += escrow.amounts.get(idx).ok_or(Error::MilestoneOutOfBounds)?;
                escrow.milestones.set(idx, MilestoneStatus::Refunded);
            }
        }
        if total == 0 {
            return Err(Error::NothingToRefund);
        }

        finalize_status(&mut escrow);
        save(&env, id, &escrow);

        token::Client::new(&env, &escrow.token).transfer(
            &env.current_contract_address(),
            &escrow.enterprise,
            &total,
        );

        Refunded { id, total }.publish(&env);
        Ok(total)
    }

    pub fn get_escrow(env: Env, id: u64) -> Result<Escrow, Error> {
        load(&env, id)
    }
}

#[cfg(test)]
mod test;
