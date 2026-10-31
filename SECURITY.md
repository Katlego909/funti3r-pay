# Security policy

## Status

Funti3r Pay runs on the Stellar **testnet** only. No real funds are held. The escrow contract has not yet had an
independent audit; its threat model and known gaps are in
[contracts/escrow/THREAT_MODEL.md](contracts/escrow/THREAT_MODEL.md).

## Reporting a vulnerability

Please report privately through GitHub: on this repository, open the **Security** tab and choose
**Report a vulnerability**. Do not open a public issue, pull request or discussion for a security problem.

Include what you found, where (file, function or endpoint), how to reproduce it, and the impact you expect.

## What to expect

- We acknowledge your report within 3 business days.
- We give you our assessment and planned fix within 10 business days.
- We tell you when it is fixed and, if you wish, credit you in the release notes.

## Scope

In scope:
- The Soroban escrow contract (`contracts/escrow`)
- The backend services (`services/`) and shared packages (`packages/`)
- The web dashboard (`apps/enterprise-dashboard`)

Out of scope:
- Third-party services we integrate with (Stellar network, MoneyGram, exchange-rate providers); report those to their owners
- Denial-of-service and volumetric attacks
- Findings that need a compromised user device or the user's own keys

Please test only against your own local or testnet setup, never against other users' data.
