extern crate std;

use super::*;
use soroban_sdk::testutils::{Address as _, Events as _, Ledger};
use soroban_sdk::{vec, Address, BytesN, Env, Event as _};

struct Setup {
    env: Env,
    client: EscrowContractClient<'static>,
    token: token::Client<'static>,
    admin: Address,
    compliance: Address,
    enterprise: Address,
    worker: Address,
    token_address: Address,
}

const NOW: u64 = 1_000;
const EXPIRY: u64 = 2_000;
const CLEARED_UNTIL: u64 = 10_000;

fn attestation(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[7u8; 32])
}

/// Contract deployed with a constructor; the worker is NOT yet cleared.
fn setup_uncleared() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = NOW);

    let token_admin = Address::generate(&env);
    let token_address = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let admin = Address::generate(&env);
    let compliance = Address::generate(&env);
    let enterprise = Address::generate(&env);
    let worker = Address::generate(&env);

    token::StellarAssetClient::new(&env, &token_address).mint(&enterprise, &1_000);

    let contract_id = env.register(EscrowContract, (admin.clone(), compliance.clone()));
    let client = EscrowContractClient::new(&env, &contract_id);
    let token = token::Client::new(&env, &token_address);

    Setup {
        env,
        client,
        token,
        admin,
        compliance,
        enterprise,
        worker,
        token_address,
    }
}

fn setup() -> Setup {
    let s = setup_uncleared();
    s.client
        .set_clearance(&s.worker, &CLEARED_UNTIL, &attestation(&s.env));
    s
}

fn create_default(s: &Setup) -> u64 {
    s.client.create(
        &s.enterprise,
        &s.worker,
        &s.token_address,
        &vec![&s.env, 100_i128, 200_i128],
        &EXPIRY,
    )
}

fn set_time(s: &Setup, ts: u64) {
    s.env.ledger().with_mut(|li| li.timestamp = ts);
}

// ── Lifecycle (unchanged behavior from v1) ───────────────────────────────────

#[test]
fn full_lifecycle_completes() {
    let s = setup();
    let id = create_default(&s);

    assert_eq!(s.token.balance(&s.enterprise), 700);
    assert_eq!(s.token.balance(&s.client.address), 300);

    s.client.approve(&id, &0);
    s.client.claim(&id, &0);
    assert_eq!(s.token.balance(&s.worker), 100);

    s.client.approve(&id, &1);
    s.client.claim(&id, &1);
    assert_eq!(s.token.balance(&s.worker), 300);
    assert_eq!(s.token.balance(&s.client.address), 0);

    assert_eq!(s.client.get_escrow(&id).status, EscrowStatus::Completed);
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
        s.client
            .try_create(&s.enterprise, &s.worker, &s.token_address, &empty, &EXPIRY),
        Err(Ok(Error::NoMilestones))
    );
    assert_eq!(
        s.client.try_create(
            &s.enterprise,
            &s.worker,
            &s.token_address,
            &vec![&s.env, 0_i128],
            &EXPIRY
        ),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        s.client.try_create(
            &s.enterprise,
            &s.worker,
            &s.token_address,
            &vec![&s.env, 100_i128],
            &500
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

    set_time(&s, 3_000);
    assert_eq!(s.client.refund(&id), 200); // only the Pending tranche
    assert_eq!(s.token.balance(&s.enterprise), 900);

    // The approved tranche survives expiry — worker claims it.
    s.client.claim(&id, &0);
    assert_eq!(s.token.balance(&s.worker), 100);
    assert_eq!(s.token.balance(&s.client.address), 0);
    assert_eq!(s.client.get_escrow(&id).status, EscrowStatus::Completed);
}

#[test]
fn refund_all_pending_marks_escrow_refunded() {
    let s = setup();
    let id = create_default(&s);
    set_time(&s, 3_000);
    assert_eq!(s.client.refund(&id), 300);
    assert_eq!(s.token.balance(&s.enterprise), 1_000);

    assert_eq!(s.client.get_escrow(&id).status, EscrowStatus::Refunded);
    assert_eq!(s.client.try_refund(&id), Err(Ok(Error::EscrowNotActive)));
    assert_eq!(
        s.client.try_approve(&id, &0),
        Err(Ok(Error::EscrowNotActive))
    );
}

#[test]
fn unknown_escrow_rejected() {
    let s = setup();
    assert_eq!(
        s.client.try_get_escrow(&42),
        Err(Ok(Error::EscrowNotFound))
    );
}

// ── Compliance gate ──────────────────────────────────────────────────────────

#[test]
fn create_rejected_for_uncleared_worker() {
    let s = setup_uncleared();
    assert_eq!(
        s.client.try_create(
            &s.enterprise,
            &s.worker,
            &s.token_address,
            &vec![&s.env, 100_i128],
            &EXPIRY
        ),
        Err(Ok(Error::NotCleared))
    );
    // Nothing was pulled from the enterprise.
    assert_eq!(s.token.balance(&s.enterprise), 1_000);
}

#[test]
fn revoked_clearance_blocks_approve_and_claim() {
    let s = setup();
    let id = create_default(&s);
    s.client.approve(&id, &0);

    s.client.revoke_clearance(&s.worker);
    assert!(!s.client.is_cleared(&s.worker));

    assert_eq!(s.client.try_claim(&id, &0), Err(Ok(Error::NotCleared)));
    assert_eq!(s.client.try_approve(&id, &1), Err(Ok(Error::NotCleared)));
    // Funds stay locked in the contract, untouched.
    assert_eq!(s.token.balance(&s.client.address), 300);
    assert_eq!(s.token.balance(&s.worker), 0);
}

#[test]
fn restored_clearance_unblocks_claim() {
    let s = setup();
    let id = create_default(&s);
    s.client.approve(&id, &0);
    s.client.revoke_clearance(&s.worker);
    assert_eq!(s.client.try_claim(&id, &0), Err(Ok(Error::NotCleared)));

    s.client
        .set_clearance(&s.worker, &CLEARED_UNTIL, &attestation(&s.env));
    s.client.claim(&id, &0);
    assert_eq!(s.token.balance(&s.worker), 100);
}

#[test]
fn expired_clearance_blocks_claim() {
    let s = setup();
    let id = create_default(&s);
    s.client.approve(&id, &0);

    set_time(&s, CLEARED_UNTIL + 1);
    assert!(!s.client.is_cleared(&s.worker));
    assert_eq!(s.client.try_claim(&id, &0), Err(Ok(Error::NotCleared)));
}

#[test]
fn clearance_must_expire_in_the_future() {
    let s = setup_uncleared();
    assert_eq!(
        s.client
            .try_set_clearance(&s.worker, &NOW, &attestation(&s.env)),
        Err(Ok(Error::InvalidClearance))
    );
}

#[test]
fn clearance_records_attestation() {
    let s = setup();
    let c = s.client.get_clearance(&s.worker).unwrap();
    assert_eq!(c.expiry, CLEARED_UNTIL);
    assert_eq!(c.attestation, attestation(&s.env));
}

#[test]
fn frozen_escrow_blocks_every_movement() {
    let s = setup();
    let id = create_default(&s);
    s.client.approve(&id, &0);

    s.client.set_frozen(&id, &true);
    assert!(s.client.get_escrow(&id).frozen);
    assert_eq!(s.client.try_claim(&id, &0), Err(Ok(Error::EscrowFrozen)));
    assert_eq!(s.client.try_approve(&id, &1), Err(Ok(Error::EscrowFrozen)));
    set_time(&s, 3_000);
    assert_eq!(s.client.try_refund(&id), Err(Ok(Error::EscrowFrozen)));
    assert_eq!(s.token.balance(&s.client.address), 300);

    s.client.set_frozen(&id, &false);
    s.client.claim(&id, &0);
    assert_eq!(s.token.balance(&s.worker), 100);
}

#[test]
fn return_frozen_sends_unclaimed_tranches_back() {
    let s = setup();
    let id = create_default(&s);
    s.client.approve(&id, &0);
    s.client.set_frozen(&id, &true);

    let returned = s.client.return_frozen(&id);
    assert_eq!(returned, 300);
    assert_eq!(s.token.balance(&s.enterprise), 1_000);
    assert_eq!(s.token.balance(&s.client.address), 0);
    assert_eq!(s.client.get_escrow(&id).status, EscrowStatus::Refunded);
}

#[test]
fn return_frozen_keeps_what_the_worker_already_claimed() {
    let s = setup();
    let id = create_default(&s);
    s.client.approve(&id, &0);
    s.client.claim(&id, &0);
    s.client.set_frozen(&id, &true);

    assert_eq!(s.client.return_frozen(&id), 200);
    assert_eq!(s.token.balance(&s.worker), 100);
    assert_eq!(s.client.get_escrow(&id).status, EscrowStatus::Completed);
}

#[test]
fn return_frozen_requires_a_freeze() {
    let s = setup();
    let id = create_default(&s);
    assert_eq!(s.client.try_return_frozen(&id), Err(Ok(Error::NotFrozen)));
    assert_eq!(s.token.balance(&s.client.address), 300);
}

#[test]
fn return_frozen_cannot_run_twice() {
    let s = setup();
    let id = create_default(&s);
    s.client.set_frozen(&id, &true);
    s.client.return_frozen(&id);
    assert_eq!(
        s.client.try_return_frozen(&id),
        Err(Ok(Error::EscrowNotActive))
    );
}

#[test]
fn return_frozen_requires_compliance_auth() {
    let s = setup();
    let id = create_default(&s);
    s.client.set_frozen(&id, &true);

    s.env.set_auths(&[]);
    assert!(s.client.try_return_frozen(&id).is_err());
    assert_eq!(s.token.balance(&s.client.address), 300);
}

#[test]
fn freeze_unknown_escrow_rejected() {
    let s = setup();
    assert_eq!(
        s.client.try_set_frozen(&7, &true),
        Err(Ok(Error::EscrowNotFound))
    );
}

// ── Authorization ────────────────────────────────────────────────────────────

#[test]
fn create_requires_enterprise_auth() {
    let s = setup();
    create_default(&s);
    let auths = s.env.auths();
    assert!(!auths.is_empty());
    assert_eq!(auths[0].0, s.enterprise);
}

#[test]
fn claim_requires_worker_auth() {
    let s = setup();
    let id = create_default(&s);
    s.client.approve(&id, &0);
    s.client.claim(&id, &0);
    assert_eq!(s.env.auths()[0].0, s.worker);
}

#[test]
fn approve_requires_enterprise_auth() {
    let s = setup();
    let id = create_default(&s);
    s.client.approve(&id, &0);
    assert_eq!(s.env.auths()[0].0, s.enterprise);
}

#[test]
fn compliance_calls_require_compliance_auth() {
    let s = setup_uncleared();
    s.client
        .set_clearance(&s.worker, &CLEARED_UNTIL, &attestation(&s.env));
    assert_eq!(s.env.auths()[0].0, s.compliance);
    s.client.revoke_clearance(&s.worker);
    assert_eq!(s.env.auths()[0].0, s.compliance);
}

#[test]
fn set_compliance_requires_admin_and_rotates_authority() {
    let s = setup();
    let new_compliance = Address::generate(&s.env);
    s.client.set_compliance(&new_compliance);
    assert_eq!(s.env.auths()[0].0, s.admin);

    // The new authority is now the one demanded for compliance calls.
    s.client.revoke_clearance(&s.worker);
    assert_eq!(s.env.auths()[0].0, new_compliance);
}

// ── Two-step admin handover ──────────────────────────────────────────────────

fn ledger_seq(s: &Setup) -> u32 {
    s.env.ledger().sequence()
}

#[test]
fn admin_handover_needs_proposal_and_acceptance() {
    let s = setup();
    let multisig = Address::generate(&s.env);
    let until = ledger_seq(&s) + 1_000;

    s.client.propose_admin(&multisig, &until);
    assert_eq!(s.env.auths()[0].0, s.admin);
    // Proposing alone changes nothing.
    assert_eq!(s.client.get_admin(), s.admin);
    assert_eq!(
        s.client.get_pending_admin(),
        Some(PendingAdmin { address: multisig.clone(), live_until_ledger: until })
    );

    s.client.accept_admin();
    assert_eq!(s.env.auths()[0].0, multisig);
    assert_eq!(s.client.get_admin(), multisig);
    assert_eq!(s.client.get_pending_admin(), None);

    // The new admin is the one demanded for admin calls.
    s.client.set_compliance(&Address::generate(&s.env));
    assert_eq!(s.env.auths()[0].0, multisig);
}

#[test]
fn propose_admin_requires_admin_auth() {
    let s = setup();
    s.env.set_auths(&[]);
    assert!(s
        .client
        .try_propose_admin(&Address::generate(&s.env), &(ledger_seq(&s) + 10))
        .is_err());
}

#[test]
fn accept_admin_requires_the_proposed_address() {
    let s = setup();
    let multisig = Address::generate(&s.env);
    s.client.propose_admin(&multisig, &(ledger_seq(&s) + 10));

    s.env.set_auths(&[]);
    assert!(s.client.try_accept_admin().is_err());
    assert_eq!(s.client.get_admin(), s.admin);
}

#[test]
fn accept_admin_without_proposal_rejected() {
    let s = setup();
    assert_eq!(s.client.try_accept_admin(), Err(Ok(Error::NoPendingAdmin)));
}

#[test]
fn expired_admin_proposal_cannot_be_accepted() {
    let s = setup();
    let until = ledger_seq(&s) + 10;
    s.client.propose_admin(&Address::generate(&s.env), &until);

    s.env.ledger().with_mut(|li| li.sequence_number = until + 1);
    assert_eq!(s.client.try_accept_admin(), Err(Ok(Error::NoPendingAdmin)));
    assert_eq!(s.client.get_pending_admin(), None);
    assert_eq!(s.client.get_admin(), s.admin);
}

#[test]
fn admin_proposal_can_be_cancelled_or_replaced() {
    let s = setup();
    let first = Address::generate(&s.env);
    let second = Address::generate(&s.env);
    let until = ledger_seq(&s) + 10;

    s.client.propose_admin(&first, &until);
    s.client.propose_admin(&second, &until);
    assert_eq!(s.client.get_pending_admin().unwrap().address, second);

    s.client.propose_admin(&second, &0);
    assert_eq!(s.client.get_pending_admin(), None);
    assert_eq!(s.client.try_accept_admin(), Err(Ok(Error::NoPendingAdmin)));
    // Cancelling when nothing is pending is an error, not a silent no-op.
    assert_eq!(
        s.client.try_propose_admin(&second, &0),
        Err(Ok(Error::NoPendingAdmin))
    );
}

#[test]
fn admin_proposal_ledger_must_be_in_range() {
    let s = setup();
    s.env.ledger().with_mut(|li| li.sequence_number = 100);
    let who = Address::generate(&s.env);
    let now = ledger_seq(&s);
    assert_eq!(
        s.client.try_propose_admin(&who, &now),
        Err(Ok(Error::InvalidLiveUntilLedger))
    );
    let too_far = now + s.env.storage().max_ttl() + 1;
    assert_eq!(
        s.client.try_propose_admin(&who, &too_far),
        Err(Ok(Error::InvalidLiveUntilLedger))
    );
}

// ── Events ───────────────────────────────────────────────────────────────────

#[test]
fn emits_typed_created_event() {
    let s = setup();
    let id = create_default(&s);
    let expected = Created {
        id,
        enterprise: s.enterprise.clone(),
        worker: s.worker.clone(),
        total: 300,
    };
    let events = s.env.events().all();
    assert!(events
        .events()
        .iter()
        .any(|e| *e == expected.to_xdr(&s.env, &s.client.address)));
}

#[test]
fn emits_clearance_event() {
    let s = setup_uncleared();
    s.client
        .set_clearance(&s.worker, &CLEARED_UNTIL, &attestation(&s.env));
    let expected = ClearanceSet {
        worker: s.worker.clone(),
        expiry: CLEARED_UNTIL,
        attestation: attestation(&s.env),
    };
    let events = s.env.events().all();
    assert!(events
        .events()
        .iter()
        .any(|e| *e == expected.to_xdr(&s.env, &s.client.address)));
}

#[test]
fn emits_compliance_changed_event() {
    let s = setup();
    let new_compliance = Address::generate(&s.env);
    s.client.set_compliance(&new_compliance);
    let expected = ComplianceChanged {
        old_compliance: s.compliance.clone(),
        new_compliance,
    };
    let events = s.env.events().all();
    assert!(events
        .events()
        .iter()
        .any(|e| *e == expected.to_xdr(&s.env, &s.client.address)));
}

// ── Limits ───────────────────────────────────────────────────────────────────

#[test]
fn milestone_count_is_capped() {
    let s = setup();
    let mut at_cap = Vec::new(&s.env);
    for _ in 0..MAX_MILESTONES {
        at_cap.push_back(1_i128);
    }
    let id = s
        .client
        .create(&s.enterprise, &s.worker, &s.token_address, &at_cap, &EXPIRY);
    assert_eq!(s.client.get_escrow(&id).milestones.len(), MAX_MILESTONES);

    let mut over_cap = at_cap.clone();
    over_cap.push_back(1_i128);
    assert_eq!(
        s.client
            .try_create(&s.enterprise, &s.worker, &s.token_address, &over_cap, &EXPIRY),
        Err(Ok(Error::TooManyMilestones))
    );
}

// ── Invariant ────────────────────────────────────────────────────────────────

/// Whatever sequence of operations runs, the contract's token balance must
/// equal the sum of tranches that are still Pending or Approved.
fn open_total(s: &Setup, id: u64) -> i128 {
    let e = s.client.get_escrow(&id);
    let mut sum = 0;
    for i in 0..e.milestones.len() {
        match e.milestones.get(i).unwrap() {
            MilestoneStatus::Pending | MilestoneStatus::Approved => {
                sum += e.amounts.get(i).unwrap()
            }
            _ => {}
        }
    }
    sum
}

#[test]
fn balance_matches_open_tranches_through_mixed_operations() {
    let s = setup();
    let id = s.client.create(
        &s.enterprise,
        &s.worker,
        &s.token_address,
        &vec![&s.env, 50_i128, 75_i128, 125_i128, 200_i128],
        &EXPIRY,
    );
    assert_eq!(s.token.balance(&s.client.address), open_total(&s, id));

    s.client.approve(&id, &0);
    s.client.approve(&id, &2);
    assert_eq!(s.token.balance(&s.client.address), open_total(&s, id));

    s.client.claim(&id, &2);
    assert_eq!(s.token.balance(&s.client.address), open_total(&s, id));

    // A freeze + revoke in the middle must not move or lose anything.
    s.client.set_frozen(&id, &true);
    s.client.revoke_clearance(&s.worker);
    assert_eq!(s.token.balance(&s.client.address), open_total(&s, id));
    s.client.set_frozen(&id, &false);
    s.client
        .set_clearance(&s.worker, &CLEARED_UNTIL, &attestation(&s.env));

    set_time(&s, 3_000);
    s.client.refund(&id);
    assert_eq!(s.token.balance(&s.client.address), open_total(&s, id));

    s.client.claim(&id, &0);
    assert_eq!(s.token.balance(&s.client.address), 0);
    assert_eq!(
        s.token.balance(&s.worker) + s.token.balance(&s.enterprise),
        1_000
    );
}
