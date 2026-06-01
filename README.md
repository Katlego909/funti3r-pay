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
- `@funti3r/enterprise-dashboard` (port 3100)

Verify: `curl http://localhost:3000/status`

## Project Structure

```
services/          - 5 microservices
apps/             - Enterprise dashboard (React) + Worker app (React Native)
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
- PostgreSQL - Transactional data
- Redis - Caching & sessions
- MongoDB - Analytics

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
- **Backend**: Express.js
- **Frontend**: React 18, React Native 0.73
- **Databases**: PostgreSQL 16, Redis 7, MongoDB 7
- **Blockchain**: Stellar SDK, Soroban (Rust)
- **DevOps**: Docker, Terraform, GitHub Actions
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

**Status**: Phase 1 - Development  
**Version**: 0.1.0  
**Last Updated**: June 2025
