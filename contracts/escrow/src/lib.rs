//! Funti3r milestone escrow.
//!
//! An enterprise funds an escrow for a worker with N milestone tranches of a
//! SAC token (native XLM on testnet, USDC on mainnet — same code). Flow:
//!
//!   create (enterprise deposits total)
//!     └─ per milestone: Pending ──approve(enterprise)──► Approved ──claim(worker)──► Claimed
//!   refund (enterprise, only after expiry): every still-Pending tranche is
//!   returned; Approved tranches stay claimable — the worker earned them.
//!
//! Escrow status: Active ─► Completed (≥1 claimed, nothing open)
//!                        └► Refunded (nothing claimed, nothing open)
#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Vec,
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
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    NextId,
    Escrow(u64),
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
}

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
    /// Enterprise funds a new escrow: transfers the sum of `amounts` into the
    /// contract and returns the escrow id.
    pub fn create(
        env: Env,
        enterprise: Address,
        worker: Address,
        token: Address,
        amounts: Vec<i128>,
        expiry: u64,
    ) -> Result<u64, Error> {
        enterprise.require_auth();

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
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

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
        };
        save(&env, id, &escrow);

        env.events()
            .publish((symbol_short!("created"), id), (enterprise, worker, total));
        Ok(id)
    }

    /// Enterprise marks a milestone as approved — the worker may then claim it.
    pub fn approve(env: Env, id: u64, idx: u32) -> Result<(), Error> {
        let mut escrow = load(&env, id)?;
        escrow.enterprise.require_auth();

        if escrow.status != EscrowStatus::Active {
            return Err(Error::EscrowNotActive);
        }
        match escrow.milestones.get(idx) {
            None => return Err(Error::MilestoneOutOfBounds),
            Some(MilestoneStatus::Pending) => {}
            Some(_) => return Err(Error::MilestoneNotPending),
        }
        escrow.milestones.set(idx, MilestoneStatus::Approved);
        save(&env, id, &escrow);

        env.events().publish((symbol_short!("approved"), id), idx);
        Ok(())
    }

    /// Worker claims an approved milestone — the tranche is paid out.
    /// Deliberately NOT gated on expiry: an approved tranche is earned.
    pub fn claim(env: Env, id: u64, idx: u32) -> Result<(), Error> {
        let mut escrow = load(&env, id)?;
        escrow.worker.require_auth();

        if escrow.status != EscrowStatus::Active {
            return Err(Error::EscrowNotActive);
        }
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

        env.events()
            .publish((symbol_short!("claimed"), id), (idx, amount));
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

        env.events().publish((symbol_short!("refunded"), id), total);
        Ok(total)
    }

    pub fn get_escrow(env: Env, id: u64) -> Result<Escrow, Error> {
        load(&env, id)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events, Ledger};
    use soroban_sdk::{vec, Address, Env};

    struct Setup {
        env: Env,
        client: EscrowContractClient<'static>,
        token: token::Client<'static>,
        enterprise: Address,
        worker: Address,
        token_address: Address,
    }

    fn setup() -> Setup {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = 1_000);

        let token_admin = Address::generate(&env);
        let token_address = env.register_stellar_asset_contract(token_admin.clone());
        let enterprise = Address::generate(&env);
        let worker = Address::generate(&env);

        token::StellarAssetClient::new(&env, &token_address).mint(&enterprise, &1_000);

        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);
        let token = token::Client::new(&env, &token_address);

        Setup { env, client, token, enterprise, worker, token_address }
    }

    fn create_default(s: &Setup) -> u64 {
        s.client.create(
            &s.enterprise,
            &s.worker,
            &s.token_address,
            &vec![&s.env, 100_i128, 200_i128],
            &2_000_u64,
        )
    }

    #[test]
    fn full_lifecycle_completes() {
        let s = setup();
        let id = create_default(&s);

        // Funding moved into the contract.
        assert_eq!(s.token.balance(&s.enterprise), 700);
        assert_eq!(s.token.balance(&s.client.address), 300);

        s.client.approve(&id, &0);
        s.client.claim(&id, &0);
        assert_eq!(s.token.balance(&s.worker), 100);

        s.client.approve(&id, &1);
        s.client.claim(&id, &1);
        assert_eq!(s.token.balance(&s.worker), 300);
        assert_eq!(s.token.balance(&s.client.address), 0);

        let escrow = s.client.get_escrow(&id);
        assert_eq!(escrow.status, EscrowStatus::Completed);
    }

    #[test]
    fn create_requires_enterprise_auth() {
        let s = setup();
        create_default(&s);
        // mock_all_auths records what require_auth demanded — the first
        // recorded auth must belong to the enterprise.
        let auths = s.env.auths();
        assert!(!auths.is_empty());
        assert_eq!(auths[0].0, s.enterprise);
    }

    #[test]
    fn claim_before_approve_rejected() {
        let s = setup();
        let id = create_default(&s);
        assert_eq!(
            s.client.try_claim(&id, &0),
            Err(Ok(Error::MilestoneNotApproved))
        );
    }

    #[test]
    fn double_claim_rejected() {
        let s = setup();
        let id = create_default(&s);
        s.client.approve(&id, &0);
        s.client.claim(&id, &0);
        assert_eq!(
            s.client.try_claim(&id, &0),
            Err(Ok(Error::MilestoneNotApproved))
        );
    }

    #[test]
    fn double_approve_rejected() {
        let s = setup();
        let id = create_default(&s);
        s.client.approve(&id, &0);
        assert_eq!(
            s.client.try_approve(&id, &0),
            Err(Ok(Error::MilestoneNotPending))
        );
    }

    #[test]
    fn out_of_bounds_milestone_rejected() {
        let s = setup();
        let id = create_default(&s);
        assert_eq!(
            s.client.try_approve(&id, &9),
            Err(Ok(Error::MilestoneOutOfBounds))
        );
    }

    #[test]
    fn invalid_create_args_rejected() {
        let s = setup();
        let empty: Vec<i128> = vec![&s.env];
        assert_eq!(
            s.client.try_create(&s.enterprise, &s.worker, &s.token_address, &empty, &2_000),
            Err(Ok(Error::NoMilestones))
        );
        assert_eq!(
            s.client.try_create(
                &s.enterprise, &s.worker, &s.token_address,
                &vec![&s.env, 0_i128], &2_000,
            ),
            Err(Ok(Error::InvalidAmount))
        );
        // expiry in the past (ledger timestamp is 1_000)
        assert_eq!(
            s.client.try_create(
                &s.enterprise, &s.worker, &s.token_address,
                &vec![&s.env, 100_i128], &500,
            ),
            Err(Ok(Error::InvalidExpiry))
        );
    }

    #[test]
    fn refund_before_expiry_rejected() {
        let s = setup();
        let id = create_default(&s);
        assert_eq!(s.client.try_refund(&id), Err(Ok(Error::NotExpired)));
    }

    #[test]
    fn refund_returns_pending_but_approved_stays_claimable() {
        let s = setup();
        let id = create_default(&s); // milestones: 100, 200 — expiry 2_000
        s.client.approve(&id, &0);

        s.env.ledger().with_mut(|li| li.timestamp = 3_000);
        let refunded = s.client.refund(&id);
        assert_eq!(refunded, 200); // only the Pending tranche
        assert_eq!(s.token.balance(&s.enterprise), 900);

        // The approved tranche survives expiry — worker claims it.
        s.client.claim(&id, &0);
        assert_eq!(s.token.balance(&s.worker), 100);
        assert_eq!(s.token.balance(&s.client.address), 0);

        let escrow = s.client.get_escrow(&id);
        assert_eq!(escrow.status, EscrowStatus::Completed);
    }

    #[test]
    fn refund_all_pending_marks_escrow_refunded() {
        let s = setup();
        let id = create_default(&s);
        s.env.ledger().with_mut(|li| li.timestamp = 3_000);
        assert_eq!(s.client.refund(&id), 300);
        assert_eq!(s.token.balance(&s.enterprise), 1_000);

        let escrow = s.client.get_escrow(&id);
        assert_eq!(escrow.status, EscrowStatus::Refunded);
        // Nothing further works on a finalized escrow.
        assert_eq!(s.client.try_refund(&id), Err(Ok(Error::EscrowNotActive)));
        assert_eq!(s.client.try_approve(&id, &0), Err(Ok(Error::EscrowNotActive)));
    }

    #[test]
    fn unknown_escrow_rejected() {
        let s = setup();
        assert_eq!(s.client.try_get_escrow(&42), Err(Ok(Error::EscrowNotFound)));
    }

    #[test]
    fn emits_created_event() {
        let s = setup();
        create_default(&s);
        let contract_events: soroban_sdk::Vec<_> = s.env.events().all();
        // Token transfer + created — at minimum the escrow contract published one.
        assert!(contract_events.iter().any(|(addr, _, _)| addr == s.client.address));
    }
}
