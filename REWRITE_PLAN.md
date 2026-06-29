# Funti3r-Pay Complete Rewrite Plan

## Scope
- Clean database schema
- Clean API contracts
- Remove SmartWallet, Wallet Kit, external wallet linking
- Workers: classic Stellar ed25519 accounts (auto-created at registration)
- Enterprises: regular accounts, create payments to workers
- Simple, auditable payment flow

## Database Schema (PostgreSQL)

### Core Tables

**users**
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('enterprise', 'worker', 'admin')),
  
  -- Worker-specific
  stellar_public_key VARCHAR(60) UNIQUE,
  stellar_secret_key TEXT, -- encrypted at rest
  
  -- User info
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  phone VARCHAR(20),
  country VARCHAR(2),
  
  -- KYC/Compliance
  kyc_status VARCHAR(20) CHECK (kyc_status IN ('pending', 'verified', 'failed', 'rejected')) DEFAULT 'pending',
  kyc_verified_at TIMESTAMP,
  
  -- Account
  status VARCHAR(20) CHECK (status IN ('active', 'suspended', 'closed')) DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  INDEX idx_email (email),
  INDEX idx_role (role),
  INDEX idx_stellar_public_key (stellar_public_key)
);

CREATE TABLE enterprises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  company_name VARCHAR(255) NOT NULL,
  company_registration VARCHAR(255),
  country VARCHAR(2),
  
  -- Wallet for enterprise (optional, for escrow)
  wallet_address VARCHAR(255),
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  INDEX idx_user_id (user_id)
);

CREATE TABLE enterprise_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) CHECK (status IN ('active', 'inactive', 'removed')) DEFAULT 'active',
  added_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  UNIQUE(enterprise_id, worker_id),
  INDEX idx_enterprise_id (enterprise_id),
  INDEX idx_worker_id (worker_id)
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES enterprises(id),
  worker_id UUID NOT NULL REFERENCES users(id),
  
  -- Amount
  amount DECIMAL(18, 8) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'XLM',
  
  -- Status flow: initiated → pending_signature → submitted → completed / failed
  status VARCHAR(20) NOT NULL CHECK (status IN (
    'initiated', 'pending_signature', 'submitted', 'completed', 'failed', 'cancelled'
  )) DEFAULT 'initiated',
  
  -- Stellar
  stellar_tx_hash VARCHAR(255),
  stellar_destination VARCHAR(60) NOT NULL, -- worker's stellar account
  stellar_source_secret TEXT, -- encrypted, used for signing
  
  -- Metadata
  description VARCHAR(500),
  reference_id VARCHAR(255),
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMP,
  completed_at TIMESTAMP,
  failed_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  INDEX idx_enterprise_id (enterprise_id),
  INDEX idx_worker_id (worker_id),
  INDEX idx_status (status),
  INDEX idx_stellar_tx_hash (stellar_tx_hash),
  INDEX idx_created_at (created_at)
);

CREATE TABLE payment_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
  
  -- Signed transaction
  signed_xdr TEXT NOT NULL,
  
  -- Who signed it
  signed_by UUID NOT NULL REFERENCES users(id),
  signed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  INDEX idx_payment_id (payment_id)
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL, -- 'user', 'payment', 'kyc', etc.
  entity_id UUID NOT NULL,
  action VARCHAR(100) NOT NULL,
  actor_id UUID REFERENCES users(id),
  
  changes JSONB, -- {field: {from: old, to: new}}
  metadata JSONB, -- additional context
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  INDEX idx_entity (entity_type, entity_id),
  INDEX idx_actor (actor_id),
  INDEX idx_created_at (created_at)
);

CREATE TABLE kyc_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  
  -- Provider info
  provider VARCHAR(50) NOT NULL DEFAULT 'manual',
  provider_request_id VARCHAR(255),
  
  -- Status
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')) DEFAULT 'pending',
  
  -- Data
  data JSONB, -- provider response
  verified_at TIMESTAMP,
  expires_at TIMESTAMP,
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  INDEX idx_user_id (user_id),
  INDEX idx_status (status)
);
```

### Redis Keys (Session/Cache)

```
session:{token_id}              → {userId, role, exp}
refresh_token:{user_id}         → {token, exp}
payment_status:{payment_id}     → {status, updated_at}
user_cache:{user_id}            → {user object}
```

### MongoDB Collections (Analytics)

```
events: {
  _id, event_type, entity_id, entity_type,
  timestamp, data: {...}
}

payment_metrics: {
  _id, date, total_payments, total_volume,
  success_rate, avg_time_to_completion
}
```

## API Specification

### User Service (3001)

**POST /auth/register**
```json
Request: {email, password, role, firstName?, lastName?}
Response: {userId, accessToken, refreshToken}
```

**POST /auth/login**
```json
Request: {email, password}
Response: {userId, accessToken, refreshToken, role}
Cookie: refresh_token (path: /)
```

**POST /auth/refresh**
```json
Request: {} (cookie: refresh_token)
Response: {accessToken}
```

**POST /auth/logout**
```json
Request: {}
Response: {message: "logged out"}
```

**GET /users/:userId**
```json
Response: {id, email, role, firstName, lastName, ...}
```

**PUT /users/:userId**
```json
Request: {firstName?, lastName?, phone?, country?}
Response: {user}
```

**GET /enterprises/:enterpriseId/workers**
```json
Response: [{id, email, firstName, lastName, status, ...}]
```

**POST /kyc/start**
```json
Request: {}
Response: {status: "pending"}
```

**GET /kyc/status**
```json
Response: {status, verifiedAt?, expiresAt?}
```

### Payment Service (3002)

**POST /payments**
```json
Request: {
  workerId, amount, currency?,
  description?, reference_id?
}
Response: {
  id, status: "initiated",
  amount, workerId, createdAt
}
```

**GET /payments**
```json
Query: ?limit=50&offset=0&status=?
Response: {payments: [...], total, hasMore}
```

**GET /payments/:paymentId**
```json
Response: {
  id, status, amount, workerId,
  stellarTxHash?, createdAt, completedAt?
}
```

**POST /payments/:paymentId/submit-signature**
```json
Request: {signedXDR}
Response: {
  id, status: "submitted",
  stellarTxHash
}
```

**GET /wallet**
```json
Response: {
  userId, stellarPublicKey,
  walletType: "worker"
}
```

### Compliance Service (3003)

**POST /kyc/verify**
```json
Request: {userId, data}
Response: {status: "pending"}
```

**GET /kyc/:userId/status**
```json
Response: {status, verifiedAt?}
```

**GET /audit/:entityId**
```json
Response: [{action, actor, changes, timestamp}]
```

### Analytics Service (3004)

**GET /dashboard**
```json
Query: ?enterpriseId=?
Response: {
  totalPayments, totalVolume, successRate,
  avgTimeToCompletion, recentPayments: [...]
}
```

**GET /payments/metrics**
```json
Query: ?startDate=&endDate=
Response: [{date, total, volume, success, avgTime}]
```

## Implementation Phases

### Phase 1: Core Infrastructure
1. Clean database schema creation
2. API Gateway with auth routing
3. User Service (auth + profile)
4. Basic Stellar integration

### Phase 2: Payments
1. Payment Service implementation
2. Stellar transaction flow
3. Payment tracking
4. Status webhooks

### Phase 3: Compliance & Analytics
1. KYC integration (basic)
2. Audit logging
3. Analytics event collection
4. Dashboard data endpoints

## Key Differences from Previous Attempt

| Previous | New |
|----------|-----|
| SmartWallet contracts | Classic Stellar accounts |
| Wallet Kit external linking | No external wallets |
| Wallets table with contract_address | None - use users.stellar_public_key |
| Complex deployment logic | Auto-create accounts at registration |
| Broken refresh token cookie | Fixed path to '/' |
| app.use() with path stripping | app.all() preserving full paths |
| Manual header forwarding issues | Working proxy configuration |

## Success Criteria

- [ ] All services run cleanly (zero TypeScript errors)
- [ ] Worker can register → auto-get Stellar account
- [ ] Worker can login → JWT token
- [ ] Enterprise can initiate payment to worker
- [ ] Payment goes to worker's Stellar account
- [ ] Status tracked and queryable
- [ ] No 404 errors on gateway routes
- [ ] Auth headers properly forwarded

