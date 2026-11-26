//! Attack tests: the escrow's money invariants under random operation sequences.
//!
//! proptest drives random sequences of every entrypoint that moves money or changes who may (create, approve, claim,
//! refund, freeze/unfreeze, return_frozen, clearance changes, the clock), across several enterprises, workers and
//! escrows, valid calls and invalid ones mixed. After EVERY step the whole contract is checked against:
//!
//! 1. Fully backed:    the contract holds exactly the sum of tranches not yet paid (pending + approved).
//! 2. Paid once:       each worker has received exactly the sum of their claimed tranches, so no tranche is ever paid
//!                     twice, and nothing is paid that was not deposited.
//! 3. Conservation:    enterprises + workers + contract always add up to what was minted: nothing is created or lost.
//! 4. Final is final:  a claimed or refunded tranche never changes again.
//! 5. No stuck money:  an escrow is active exactly while it still has unpaid tranches (claims need it active).
//! 6. Earned is kept:  a refund takes back only pending tranches, never an approved (earned) one.
//!
//! Runs in plain `cargo test` (CI). PROPTEST_CASES raises the case count for a deeper local run.
extern crate std;

use super::*;
use proptest::prelude::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::testutils::EnvTestConfig;
use soroban_sdk::{Address, BytesN, Env, Vec as SVec};
use std::vec::Vec;

const ENTERPRISES: usize = 2;
const WORKERS: usize = 2;
const MINTED_PER_ENTERPRISE: i128 = 1_000_000;
const START: u64 = 1_000;
const CLEARED_UNTIL: u64 = 1_000_000;

#[derive(Debug, Clone)]
enum Op {
    Create { ent: usize, worker: usize, amounts: Vec<i128>, expires_in: u64 },
    Approve { escrow: usize, idx: u32 },
    Claim { escrow: usize, idx: u32 },
    Refund { escrow: usize },
    Freeze { escrow: usize, frozen: bool },
    ReturnFrozen { escrow: usize },
    Revoke { worker: usize },
    Clear { worker: usize },
    Advance { secs: u64 },
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        3 => (0..ENTERPRISES, 0..WORKERS, prop::collection::vec(1i128..=10_000, 1..=4), 1u64..600)
            .prop_map(|(ent, worker, amounts, expires_in)| Op::Create { ent, worker, amounts, expires_in }),
        4 => (any::<usize>(), 0u32..5).prop_map(|(escrow, idx)| Op::Approve { escrow, idx }),
        4 => (any::<usize>(), 0u32..5).prop_map(|(escrow, idx)| Op::Claim { escrow, idx }),
        2 => any::<usize>().prop_map(|escrow| Op::Refund { escrow }),
        1 => (any::<usize>(), any::<bool>()).prop_map(|(escrow, frozen)| Op::Freeze { escrow, frozen }),
        1 => any::<usize>().prop_map(|escrow| Op::ReturnFrozen { escrow }),
        1 => (0..WORKERS).prop_map(|worker| Op::Revoke { worker }),
        1 => (0..WORKERS).prop_map(|worker| Op::Clear { worker }),
        2 => (0u64..400).prop_map(|secs| Op::Advance { secs }),
    ]
}

struct World {
    env: Env,
    client: EscrowContractClient<'static>,
    token: token::Client<'static>,
    token_address: Address,
    enterprises: Vec<Address>,
    workers: Vec<Address>,
    /// Escrow id → the worker index it pays, in creation order.
    escrows: Vec<(u64, usize)>,
    /// Escrow id → its tranche statuses at the previous check, for invariant 4.
    last_seen: Vec<SVec<MilestoneStatus>>,
}

impl World {
    fn new() -> Self {
        // No test snapshot per case: hundreds of random runs would only add noise to test_snapshots/.
        let env = Env::new_with_config(EnvTestConfig { capture_snapshot_at_drop: false });
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = START);
        let token_address = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
        let minter = token::StellarAssetClient::new(&env, &token_address);
        let enterprises: Vec<Address> = (0..ENTERPRISES).map(|_| Address::generate(&env)).collect();
        for e in &enterprises {
            minter.mint(e, &MINTED_PER_ENTERPRISE);
        }
        let workers: Vec<Address> = (0..WORKERS).map(|_| Address::generate(&env)).collect();
        let contract_id = env.register(EscrowContract, (Address::generate(&env), Address::generate(&env)));
        let client = EscrowContractClient::new(&env, &contract_id);
        client.set_token_allowed(&token_address, &true);
        for w in &workers {
            client.set_clearance(w, &CLEARED_UNTIL, &BytesN::from_array(&env, &[7u8; 32]));
        }
        let token = token::Client::new(&env, &token_address);
        World { env, client, token, token_address, enterprises, workers, escrows: Vec::new(), last_seen: Vec::new() }
    }

    /// The escrow an op aims at: any index maps onto an existing escrow, so most ops hit a real one.
    fn pick(&self, i: usize) -> Option<u64> {
        if self.escrows.is_empty() { None } else { Some(self.escrows[i % self.escrows.len()].0) }
    }

    fn apply(&mut self, op: &Op) {
        // Every call is a `try_`: a refused call is a normal outcome. The invariants are what must hold either way.
        match op {
            Op::Create { ent, worker, amounts, expires_in } => {
                let now = self.env.ledger().timestamp();
                let mut v = SVec::new(&self.env);
                for a in amounts {
                    v.push_back(*a);
                }
                let r = self.client.try_create(&self.enterprises[*ent], &self.workers[*worker], &self.token_address, &v, &(now + expires_in));
                if let Ok(Ok(id)) = r {
                    self.escrows.push((id, *worker));
                    self.last_seen.push(SVec::new(&self.env));
                }
            }
            Op::Approve { escrow, idx } => {
                if let Some(id) = self.pick(*escrow) { let _ = self.client.try_approve(&id, idx); }
            }
            Op::Claim { escrow, idx } => {
                if let Some(id) = self.pick(*escrow) { let _ = self.client.try_claim(&id, idx); }
            }
            Op::Refund { escrow } => {
                if let Some(id) = self.pick(*escrow) {
                    let before = self.client.get_escrow(&id).milestones;
                    if let Ok(Ok(_)) = self.client.try_refund(&id) {
                        // 6. A refund takes back only Pending tranches: an Approved one is earned and stays claimable.
                        let after = self.client.get_escrow(&id).milestones;
                        for i in 0..before.len() {
                            if before.get(i) == Some(MilestoneStatus::Approved) {
                                assert_eq!(after.get(i), Some(MilestoneStatus::Approved), "refund of escrow {} took approved tranche {}", id, i);
                            }
                        }
                    }
                }
            }
            Op::Freeze { escrow, frozen } => {
                if let Some(id) = self.pick(*escrow) { let _ = self.client.try_set_frozen(&id, frozen); }
            }
            Op::ReturnFrozen { escrow } => {
                if let Some(id) = self.pick(*escrow) { let _ = self.client.try_return_frozen(&id); }
            }
            Op::Revoke { worker } => self.client.revoke_clearance(&self.workers[*worker]),
            Op::Clear { worker } => {
                self.client.set_clearance(&self.workers[*worker], &CLEARED_UNTIL, &BytesN::from_array(&self.env, &[7u8; 32]));
            }
            Op::Advance { secs } => self.env.ledger().with_mut(|li| li.timestamp += secs),
        }
    }

    fn check(&mut self) -> Result<(), TestCaseError> {
        let mut unpaid: i128 = 0;
        let mut claimed_by_worker = [0i128; WORKERS];

        for (n, (id, worker)) in self.escrows.iter().enumerate() {
            let e = self.client.get_escrow(id);
            prop_assert_eq!(e.amounts.len(), e.milestones.len());
            let mut open = false;
            for i in 0..e.milestones.len() {
                let amount = e.amounts.get(i).unwrap();
                match e.milestones.get(i).unwrap() {
                    MilestoneStatus::Pending | MilestoneStatus::Approved => { unpaid += amount; open = true; }
                    MilestoneStatus::Claimed => claimed_by_worker[*worker] += amount,
                    MilestoneStatus::Refunded => {}
                }
                // 4. Final is final.
                if let Some(before) = self.last_seen[n].get(i) {
                    if before == MilestoneStatus::Claimed || before == MilestoneStatus::Refunded {
                        prop_assert_eq!(e.milestones.get(i).unwrap(), before, "escrow {} tranche {} left a final state", id, i);
                    }
                }
            }
            // 5. No stuck money.
            prop_assert_eq!(e.status == EscrowStatus::Active, open, "escrow {} is {:?} with open tranches = {}", id, e.status, open);
            self.last_seen[n] = e.milestones.clone();
        }

        // 1. Fully backed.
        prop_assert_eq!(self.token.balance(&self.client.address), unpaid, "contract balance must equal unpaid tranches");
        // 2. Paid once: workers start with nothing, so their balance is exactly what they claimed.
        for (w, addr) in self.workers.iter().enumerate() {
            prop_assert_eq!(self.token.balance(addr), claimed_by_worker[w], "worker {} paid other than their claimed tranches", w);
        }
        // 3. Conservation.
        let held: i128 = self.enterprises.iter().chain(self.workers.iter()).map(|a| self.token.balance(a)).sum::<i128>()
            + self.token.balance(&self.client.address);
        prop_assert_eq!(held, MINTED_PER_ENTERPRISE * ENTERPRISES as i128, "tokens were created or lost");
        Ok(())
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, ..ProptestConfig::default() })]

    #[test]
    fn money_invariants_hold_under_any_operation_sequence(ops in prop::collection::vec(op(), 1..60)) {
        let mut world = World::new();
        for op in &ops {
            world.apply(op);
            world.check()?;
        }
    }
}

// ── Targeted attacks ─────────────────────────────────────────────────────────

/// A deposit whose tranches sum past i128 is refused before any token moves (no wrap-around to a small total).
#[test]
fn overflowing_tranche_total_is_refused_without_moving_money() {
    let w = World::new();
    let before = w.token.balance(&w.enterprises[0]);
    let mut amounts = SVec::new(&w.env);
    amounts.push_back(i128::MAX);
    amounts.push_back(1);
    let r = w.client.try_create(&w.enterprises[0], &w.workers[0], &w.token_address, &amounts, &(START + 100));
    assert_eq!(r, Err(Ok(Error::InvalidAmount)));
    assert_eq!(w.token.balance(&w.enterprises[0]), before);
    assert_eq!(w.token.balance(&w.client.address), 0);
}

/// Zero and negative tranches are refused: a negative one would otherwise shrink the deposit below what is owed.
#[test]
fn non_positive_tranches_are_refused() {
    let w = World::new();
    for bad in [0i128, -1, i128::MIN] {
        let mut amounts = SVec::new(&w.env);
        amounts.push_back(500);
        amounts.push_back(bad);
        let r = w.client.try_create(&w.enterprises[0], &w.workers[0], &w.token_address, &amounts, &(START + 100));
        assert_eq!(r, Err(Ok(Error::InvalidAmount)), "tranche {} accepted", bad);
    }
    assert_eq!(w.token.balance(&w.client.address), 0);
}

/// Claiming the same tranche again, refunding after it was claimed, or returning it from a freeze never pays twice.
#[test]
fn a_claimed_tranche_cannot_be_paid_again_by_any_path() {
    let mut w = World::new();
    w.apply(&Op::Create { ent: 0, worker: 0, amounts: std::vec![300, 700], expires_in: 50 });
    let id = w.escrows[0].0;
    w.client.approve(&id, &0);
    w.client.claim(&id, &0);
    assert_eq!(w.client.try_claim(&id, &0), Err(Ok(Error::MilestoneNotApproved)));

    w.env.ledger().with_mut(|li| li.timestamp += 100);
    assert_eq!(w.client.refund(&id), 700, "refund must return only the unclaimed tranche");
    assert_eq!(w.client.try_refund(&id), Err(Ok(Error::EscrowNotActive)));
    assert_eq!(w.client.try_return_frozen(&id), Err(Ok(Error::EscrowNotActive)));

    assert_eq!(w.token.balance(&w.workers[0]), 300);
    assert_eq!(w.token.balance(&w.client.address), 0);
    w.check().unwrap();
}

/// One escrow's tranches can never be claimed or refunded through another escrow's id: each id pays only its own.
#[test]
fn escrows_cannot_drain_each_other() {
    let mut w = World::new();
    w.apply(&Op::Create { ent: 0, worker: 0, amounts: std::vec![100], expires_in: 50 });
    w.apply(&Op::Create { ent: 1, worker: 1, amounts: std::vec![9_000], expires_in: 50 });
    let (small, big) = (w.escrows[0].0, w.escrows[1].0);
    w.client.approve(&small, &0);
    // This escrow has one tranche: an index borrowed from another escrow does not reach that escrow's money.
    assert_eq!(w.client.try_claim(&small, &1), Err(Ok(Error::MilestoneOutOfBounds)));
    w.client.claim(&small, &0);
    assert_eq!(w.token.balance(&w.workers[0]), 100);
    assert_eq!(w.token.balance(&w.client.address), 9_000, "the other escrow's deposit is untouched");
    w.env.ledger().with_mut(|li| li.timestamp += 100);
    assert_eq!(w.client.refund(&big), 9_000);
    w.check().unwrap();
}
