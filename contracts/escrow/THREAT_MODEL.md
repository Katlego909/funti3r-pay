# funti3r-escrow threat model

Scope: the Soroban contract in `src/lib.rs`, plus the trust it places in the Funti3r Pay backend that calls it.
Status: testnet only, no real funds. This document is the input for an independent audit (SCF Audit Bank); it is
not a substitute for one.

## Roles and powers

| Role | Who holds it today | Can call | Can it move funds? |
|---|---|---|---|
| **Admin** | Platform operator key (`STELLAR_OPERATOR_SECRET`) | `set_compliance`, `upgrade`, `propose_admin` | Not directly, but `upgrade` can replace the code, so in effect it controls everything |
| **Pending admin** | Address named by `propose_admin` | `accept_admin` (until `live_until_ledger`) | No |
| **Compliance** | Dedicated key (`ESCROW_COMPLIANCE_SECRET`), separate from admin and users | `set_clearance`, `revoke_clearance`, `set_frozen`, `return_frozen` | Only back to the escrow's own enterprise, and only while the escrow is frozen |
| **Enterprise** | The employer's account (custodial: signed by the platform) | `create`, `approve`, `refund` | Deposits; recovers still-Pending tranches after expiry |
| **Worker** | The worker's account (custodial: signed by the platform) | `claim` | Receives approved tranches |
| **Anyone** | Unauthenticated | `get_escrow`, `get_clearance`, `is_cleared`, `get_admin`, `get_pending_admin` | No |

## Assets

1. Tokens held by the contract, per escrow, in that escrow's `token`.
2. Worker clearances: these decide who may receive money.
3. The admin and compliance roles.

## Trust assumptions

- **Custody.** Enterprise and worker keys are held by the platform (AES-256-GCM encrypted with `MASTER_ENCRYPTION_KEY`)
  and the backend signs on their behalf. The contract's `require_auth` checks therefore prove *the platform* acted, not
  the end user. A compromise of the backend plus the master key compromises every user's funds. This is the largest trust
  assumption and is outside the contract.
- **Compliance bridge.** The backend re-screens a worker right before each create / approve / claim and syncs the
  on-chain clearance (`services/payment-service/src/lib/clearance.ts`). It fails closed: if the compliance service is
  unreachable, nothing is cleared. Clearances are short-lived (default 24 h), so a stale one self-expires.
- **Token.** The backend only ever passes a Stellar Asset Contract (native XLM on testnet; USDC planned for mainnet). The
  contract itself does not check this (see gaps).
- **Admin honesty.** Until the admin is a multisig, one key can upgrade the contract.

Attacker model (from the Stellar smart-contract security guide): the attacker controls every argument, transaction
ordering and timing, every account they hold keys for, and can deploy contracts that mimic any interface.

## Threats and mitigations

| # | Threat | Mitigation | Tested by |
|---|---|---|---|
| T1 | Worker claims the same milestone twice | Milestone moves Approved → Claimed before the transfer; a second claim fails `MilestoneNotApproved` | `double_claim_rejected` |
| T2 | Worker claims before approval | `claim` requires `Approved` | `claim_before_approve_rejected` |
| T3 | Contract pays out more than was deposited | Each tranche is paid once from its own escrow; totals use checked addition; amounts must be > 0 | `balance_matches_open_tranches_through_mixed_operations`, `invalid_create_args_rejected` |
| T4 | Enterprise takes back money the worker already earned | `refund` returns only Pending tranches, only after expiry; Approved stays claimable | `refund_returns_pending_but_approved_stays_claimable` |
| T5 | Payment to a sanctioned or unverified worker | `create`, `approve` and `claim` require a live clearance; compliance can revoke instantly | `create_rejected_for_uncleared_worker`, `revoked_clearance_blocks_approve_and_claim`, `expired_clearance_blocks_claim` |
| T6 | Sanctions hit after funds are locked | Compliance freezes the escrow (blocks approve, claim and refund), then `return_frozen` sends unclaimed tranches to the enterprise | `frozen_escrow_blocks_every_movement`, `return_frozen_*` |
| T7 | Stolen compliance key | It can block payouts and return funds to the escrow's own enterprise, but has no path to pay itself or anyone else. Admin can rotate it with `set_compliance` | `return_frozen_requires_compliance_auth`, `set_compliance_requires_admin_and_rotates_authority` |
| T8 | Stolen admin key | Can upgrade the code and so take everything. **Mitigation in progress:** move the admin to a Stellar multisig account via the two-step handover | `admin_handover_*`, `accept_admin_requires_the_proposed_address` |
| T9 | Admin handed to a wrong or unusable address | Two-step handover: the new address must sign `accept_admin`, within a ledger deadline | `expired_admin_proposal_cannot_be_accepted`, `admin_proposal_can_be_cancelled_or_replaced` |
| T10 | Missing authorization on a privileged path | Every state-changing function calls `require_auth` on the correct role | the `*_requires_*_auth` tests |
| T11 | Re-initialization | Roles are set in `__constructor`, which runs once, atomically, at deploy | n/a (platform guarantee) |
| T12 | Escrow or clearance state archived (TTL) | Escrows and clearances are persistent and extended ~30 days on every write; an archived clearance reads as "not cleared" (fails closed); archived escrows can be restored, not lost | not yet tested |
| T13 | Front-running / ordering | No price-dependent logic; each call checks state atomically within one invocation | n/a |
| T15 | An escrow with so many milestones that settling it exceeds resource limits | `create` rejects more than 50 milestones (`TooManyMilestones`), matching the API's limit, so every per-milestone loop is bounded | `milestone_count_is_capped` |
| T14 | Reentrancy | No classical cross-contract reentrancy on Stellar; state is saved before each outgoing transfer | n/a |

## Security checklist (Stellar smart-contract guide)

| Item | Status |
|---|---|
| All privileged functions require appropriate authorization | Done |
| Initialization only once (`__constructor`) | Done |
| External contract calls validated / allowlisted | **Gap**: `create` accepts any `token` address (see G2) |
| Arithmetic checked; input signs and ranges validated | Done (checked arithmetic on every sum and counter, `amount > 0`, milestone count ≤ 50, `overflow-checks = true` in release) |
| Storage keys typed and collision-free | Done (`DataKey` enum) |
| Critical TTLs extended proactively | Done for writes; **gap**: no TTL monitoring yet |
| Events emitted for auditable state changes | Done (create, approve, claim, refund, return, clearance, freeze, compliance rotation, admin handover) |
| Upgrade path gated and tested | Gated by admin; handover tested; **gap**: no upgrade test (G4) |
| Emergency controls and incident runbook | Per-escrow freeze done; runbook planned |
| Static analysis (Scout) run | Done, see below |

## Static analysis (Scout 0.3.17, 2026-11-01)

[Scout](https://github.com/CoinFabrik/scout-audit) by CoinFabrik, the analyser the Stellar smart-contract guide
recommends, run on `funti3r-escrow`.

How it was run: Scout 0.3.17 cannot currently build its analysis driver on any machine, because `dylint_driver` 4.1.2
checks out rust-clippy's `master` branch, which rust-clippy has renamed to `main`. We ran it against a local mirror of
rust-clippy with a `master` branch pointing at `main`, redirected for that run only through
`GIT_CONFIG_KEY_0=url.<mirror>.insteadOf`. Scout itself was not modified.

First run: 4 critical, 5 medium, 11 enhancement. Triage:

| Finding | Where | Verdict | Action |
|---|---|---|---|
| Integer overflow (critical, ×4) | `propose_admin` TTL, `return_frozen` and `refund` totals, `create` id counter | Not exploitable (each was bounded by an earlier check or by the sum checked at `create`), but fixed for defence in depth | Checked arithmetic at all four sites; cleared on the re-run |
| Unbounded loop (medium, ×3) | per-milestone loops in `create`, `return_frozen`, `refund` | Real: nothing capped the milestone count | `MAX_MILESTONES = 50` (error #17, T15). Scout still flags the loops because it cannot see a bound that comes from validated input |
| `Vec` input not validated (medium) | `create(amounts)` | Each element is checked (> 0, checked sum) and the length is now capped | No further change |
| Ineffective `extend_ttl` (medium) | `propose_admin` | Intended: the pending-admin entry is extended exactly to its deadline, and only when a proposal is made | No change |
| Storage change without event (enhancement, ×11) | state-changing functions | One real gap: `set_compliance` emitted nothing. Every other flagged function already publishes an event; Scout does not recognise the `#[contractevent]` `.publish()` pattern | `ComplianceChanged` event added (`emits_compliance_changed_event`) |

Re-run after the fixes: 0 critical. The remaining medium and enhancement items are the false positives above.

## Known gaps

- **G1. Single-key admin.** The two-step handover exists, but the admin is still one key until it is moved to a multisig
  account (planned before mainnet).
- **G2. Any token accepted at `create`.** A malicious token contract can only affect escrows that use it (each escrow pays
  out of its own token), but an allowlist (e.g. USDC SAC only) would remove the class. Planned with the USDC change.
- **G3. No property / fuzz tests yet.** Invariants to fuzz: contract balance per token equals the sum of open tranches; no
  milestone is paid twice; refunds never touch Approved tranches. Planned next.
- **G4. No test that `upgrade` keeps storage and rejects non-admins.**
- **G5. No audit yet.** Application to the SCF Audit Bank is planned; mainnet deployment waits for the audit and its fixes.
- **G6. Custodial keys.** See trust assumptions; keys move to a cloud key-management service before mainnet.
