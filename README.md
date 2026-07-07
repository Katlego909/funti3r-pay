# Funti3r-pay

**Blockchain-powered cross-border workforce payments with instant settlement and compliance-by-design**

Funti3r-pay enables enterprises to pay global teams quickly, compliantly, and cost-effectively using Stellar blockchain technology.

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm 9+
- Docker Desktop

### Setup (5 minutes)

```bash
git clone https://github.com/Katlego909/funti3r-pay.git
cd funti3r-pay
cp .env.example .env.local
pnpm install
docker-compose up -d
```

### Run Services

```bash
pnpm --filter @funti3r/api-gateway dev
```

Other services available:
- `@funti3r/user-service` (port 3001)
- `@funti3r/payment-service` (port 3002)
- `@funti3r/compliance-service` (port 3003)
- `@funti3r/analytics-service` (port 3004)
- `@funti3r/enterprise-dashboard` (port 3100) — unified web app for both enterprises and workers,
  role-based routing after login

Verify: `curl http://localhost:3000/status`

> **Tip:** run the dashboard independently (`pnpm --filter=@funti3r/enterprise-dashboard dev`)
> rather than a single root `pnpm dev`, so one backend service crashing doesn't tear down the
> whole group.

### Testnet currency liquidity (for local-currency payouts)

The local African currencies (NGN/KES/GHS/ZAR/UGX) are self-hosted on testnet: an issuer
account issues them and a distributor seeds DEX liquidity at live FX rates so path payments
can route. Run once (and re-run to refresh rates):

```bash
cd services/payment-service
node --env-file=../../.env.local --import tsx scripts/setup-africa-liquidity.ts
```

On mainnet, point the registry at real anchors (e.g. Cowrie for NGN) — no code change.

## Project Structure

```
services/          - 5 microservices
apps/             - Unified web dashboard (React) + Worker mobile app (React Native)
packages/         - Shared types, utilities, database clients
contracts/        - Soroban smart contracts (Rust)
infrastructure/   - Docker, Terraform configurations
docs/             - Product requirements and briefs
```

## Key Features

- **Instant Settlement** - ≤5 minute settlement via Stellar blockchain
- **Cost Reduction** - 30%+ cost reduction vs traditional payments
- **Compliance-by-Design** - Automated KYC/AML verification
- **Multi-Currency Support** - African currencies and USD
- **Worker Mobile App** - Payment tracking and method selection
- **Enterprise Dashboard** - Payment management and analytics

## What It Does

Funti3r-Pay lets enterprises pay a global workforce on Stellar — fast, low-cost, and in the
currency each worker actually wants:

**Payments**
- **Classic Stellar XLM payouts** — enterprise → worker, signed + submitted on-chain.
- **USDC stablecoin payouts** — exact USDC delivered via strict-receive path payment, funded
  from the enterprise's XLM through the Stellar DEX; worker trustline auto-created.
- **Multi-currency payouts (USD → local)** — the employer sends a **USD** amount and the worker
  receives their **preferred local currency** (NGN, KES, GHS, ZAR, UGX), converted at **live FX
  rates** via Stellar path payments. (e.g. `$10 → 13,766 NGN` settled on-chain.)
- **Batch payouts** — pay many workers in one request, executed sequentially; recorded in
  `payment_batches` with per-payment linkage; returns partial-success (HTTP 207) when some fail.
- **Worker payout-currency preference** — workers choose what they get paid in ("Get Paid In").

**Auth & accounts**
- **WebAuthn / passkey** registration & login (`@simplewebauthn`), plus a **dev login**
  (email-only, non-production) so local testing doesn't require a passkey.
- Each user gets a **classic Stellar ed25519 account** at registration, auto-funded on testnet
  via Friendbot. **Secret keys are encrypted at rest** (AES-256-GCM).

**Compliance**
- KYC submit/status/approve/reject endpoints with an **auto-approve mode** for testnet
  (`COMPLIANCE_AUTO_APPROVE=true`).

**Dashboard (React + Vite, port 3100)**
- One landing page, one login/register flow, role-based routing after auth — no separate apps.
- **Enterprise** view: send single/batch payments, worker directory + KYC view, wallet
  balances, payment list, and **insights charts** (volume over time, payments by status).
- **Worker** view: balances (XLM + USDC + any local currency), payment history, KYC,
  payout-currency selector, and **insights charts** (earnings over time, income by asset).
- **Correct multi-currency valuation** — totals and charts convert each currency to USD with
  live rates (no naive cross-currency summing).
- **Live pricing** — XLM/USD (CoinGecko) and USD→fiat (open.er-api.com) feeds.

## Architecture

**Microservices:**
- **API Gateway** - Request routing & authentication
- **User Service** - User management & authentication
- **Payment Service** - Stellar blockchain integration
- **Compliance Service** - KYC/AML & audit trails
- **Analytics Service** - Metrics & reporting

**Frontend:**
- **Enterprise Dashboard** (React + Vite)
- **Worker Mobile App** (React Native)

**Data:**
- PostgreSQL - Transactional data & analytics
- Redis - Caching & sessions

**Blockchain:**
- Stellar Network (testnet & mainnet)
- Soroban Smart Contracts

## Development

### Code Standards
- TypeScript strict mode
- ESLint for linting
- Prettier for formatting
- Jest/Vitest for testing

### Before Committing
```bash
pnpm type-check    # Check types
pnpm lint          # Lint code
pnpm format        # Auto-format
pnpm test          # Run tests
```

### Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## Documentation

- [Product Requirements](docs/prd.md) - Full specifications
- [Project Brief](docs/brief.md) - Overview and context
- [Contributing Guide](CONTRIBUTING.md) - How to contribute
- [.env.example](.env.example) - Environment variables

## Technology Stack

- **Runtime**: Node.js 18+ with TypeScript
- **Backend**: Node.js + TypeScript + Express
- **Frontend**: React + TypeScript (Enterprise Dashboard)
- **Mobile**: React Native + TypeScript (Worker App)
- **Databases**: PostgreSQL 16, Redis 7
- **Blockchain**: Rust + Soroban (Smart Contracts)
- **Infrastructure**: AWS + Docker + Kubernetes
- **CI/CD**: GitHub Actions
- **Package Manager**: pnpm with Turborepo

## Current Phase

**Phase 1**: Core Infrastructure & Authentication
- Microservices scaffold (Complete)
- Shared libraries (Complete)
- Database setup (Complete)
- Git configuration (Complete)
- CI/CD pipeline (Complete)

Next: User authentication, payment processing foundation

## Project Goals

- **Scale**: 2,000+ monthly active workers (12 months)
- **Volume**: $1.5-$3.0M payout volume
- **Performance**: 99%+ payment success, 99.9% uptime
- **Compliance**: 100% regulatory compliance

## License

[To be determined]

## Contact

See [CONTRIBUTING.md](CONTRIBUTING.md) for team guidelines.

---

**Status**: Active development  
**Version**: 0.1.0  
**Last Updated**: June 2026
