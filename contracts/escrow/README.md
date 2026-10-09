# funti3r-escrow

Soroban milestone escrow with an on-chain compliance gate, used by Funti3r Pay
to hold an employer's funds and release them to a worker only after approval
and compliance checkpoints pass.

## What it does

An enterprise locks funds (any SEP-41 token — native XLM via its SAC on
testnet, USDC on mainnet) in N milestone tranches for one worker.

```
create ──► per milestone:  Pending ──approve (enterprise)──► Approved ──claim (worker)──► Claimed
                              └── after expiry: refund (enterprise) ──► Refunded
```

- **approve** — the enterprise confirms the work; the worker may now claim.
- **claim** — the worker pulls the approved tranche. Not gated on expiry: approved money is earned.
- **refund** — after expiry the enterprise recovers every still-Pending tranche. Approved tranches stay claimable.

## Compliance gate

A dedicated `compliance` authority (the platform's KYC/AML screening service —
a different key from every enterprise and worker) controls who may receive money:

| Call | Who | Effect |
|---|---|---|
| `set_clearance(worker, expiry, attestation)` | compliance | Clears a worker until `expiry`; `attestation` is the sha256 of the off-chain screening record behind the decision |
| `revoke_clearance(worker)` | compliance | Immediately removes the clearance (e.g. a new sanctions hit) |
| `set_frozen(id, bool)` | compliance | Holds one escrow: blocks approve, claim **and** refund until released |
| `return_frozen(id)` | compliance | Resolves an upheld hold: every tranche the worker has not claimed (pending or approved) goes back to the enterprise. Only works while the escrow is frozen |

`create`, `approve` and `claim` revert unless the worker holds a live clearance
(`NotCleared`, #11), and revert on a frozen escrow (`EscrowFrozen`, #12). A
revoked or expired clearance never moves funds — they stay locked in the
contract until compliance clears the worker again.

The backend re-screens a worker with the compliance service right before every
create / approve / claim / cash-out and syncs the on-chain clearance to match
(`services/payment-service/src/lib/clearance.ts`), so the contract is the
enforcement point and the backend is the bridge.

## Administration

- `__constructor(admin, compliance)` — runs atomically at deploy; no init front-running window.
- `set_compliance(new)` — admin rotates the compliance authority key.
- `upgrade(new_wasm_hash)` — admin swaps the code; address and storage survive.

## Errors

| # | Error | Meaning |
|---|---|---|
| 1 | EscrowNotFound | |
| 2 | NoMilestones | |
| 3 | InvalidAmount | Non-positive or overflowing amount |
| 4 | InvalidExpiry | Expiry not in the future |
| 5 | EscrowNotActive | Already completed / refunded |
| 6 | MilestoneOutOfBounds | |
| 7 | MilestoneNotPending | |
| 8 | MilestoneNotApproved | |
| 9 | NotExpired | Refund before expiry |
| 10 | NothingToRefund | |
| 11 | NotCleared | Worker has no live compliance clearance |
| 12 | EscrowFrozen | Compliance hold |
| 13 | InvalidClearance | Clearance expiry not in the future |
| 14 | NotFrozen | `return_frozen` on an escrow that is not frozen |

## Build, test, deploy

Requires Rust ≥ 1.91, the `wasm32v1-none` target, and `stellar-cli` ≥ 25.2.

```bash
cd contracts
cargo test -p funti3r-escrow                       # 26 unit tests
stellar contract build --package funti3r-escrow    # -> target/wasm32v1-none/release/funti3r_escrow.wasm
sha256sum target/wasm32v1-none/release/funti3r_escrow.wasm
```

Build for `wasm32v1-none`, not `wasm32-unknown-unknown`: modern rustc emits
post-MVP WASM features on the latter that the Soroban VM rejects.

Deploy to testnet (admin = `STELLAR_OPERATOR_SECRET`, compliance =
`ESCROW_COMPLIANCE_SECRET`, both funded testnet accounts):

```bash
cd services/payment-service
node --env-file=../../.env.local --import tsx scripts/deploy-escrow.ts
node --env-file=../../.env.local --import tsx scripts/escrow-e2e.ts   # full gate scenario on testnet
```

## Testnet deployment

- Contract: `CBMFR6XLDVHLR3DHQJOKOA6VC356K33KZEWREVDGYC7KFGAIQCGP2ARC`
- Wasm sha256: `bb2c611ea053ef5636b5742d8670e6eb283dd7197a32cd234bb48caafa79c219` (14,993 bytes)
- Explorer: https://stellar.expert/explorer/testnet/contract/CBMFR6XLDVHLR3DHQJOKOA6VC356K33KZEWREVDGYC7KFGAIQCGP2ARC
