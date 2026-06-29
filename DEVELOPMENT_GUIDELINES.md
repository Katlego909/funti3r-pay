# Development Guidelines - Funti3r-Pay

## Core Principles

### 1. Official Documentation via Context7

For **every** library, framework, SDK, or tool we use:

✅ **ALWAYS** fetch official documentation via context7 MCP  
✅ Use patterns from official examples  
✅ Follow best practices from authoritative sources  
✅ Comment in code when diverging from official patterns  

### Example Pattern

```typescript
// Step 1: Fetch docs for the tool/library
context7.resolve-library-id("Stellar SDK")
context7.query-docs("/stellar/js-stellar-sdk", "How to build and submit transactions?")

// Step 2: Follow official pattern
import { Horizon, TransactionBuilder, Keypair } from '@stellar/stellar-sdk';
const server = new Horizon.Server(HORIZON_URL);
const account = await server.loadAccount(publicKey);
const fee = await server.fetchBaseFee(); // ← Official pattern, not hardcoded

// Step 3: Implement with logging
logger.info('[Stellar] Building transaction', { destination, amount });
transaction.sign(keypair);
const result = await server.submitTransaction(transaction);
logger.info('[Stellar] Transaction submitted', { txHash: result.hash });
```

---

## Logging Standards

### Structured Logging Pattern

Every significant operation MUST log:

```typescript
// Component label [Component] action description
logger.info('[ComponentName] Detailed action', {
  // Context fields (IDs, amounts, statuses)
  paymentId,
  userId,
  status,
  // Operation details
  amount,
  destination,
  // Results or next steps
  txHash,
  nextStep: 'confirmation tracking',
});
```

### Logging Levels

- **`info`** - Normal operations (user registration, payment creation, tx submission)
- **`warn`** - Recoverable issues (missing optional fields, retries, timeouts)
- **`error`** - Failures that need investigation (auth failures, network errors, validation failures)

### Queryable Logging

All logs MUST be queryable via REST API:

```bash
# View all logs
GET /logs

# Filter by component
GET /logs?component=StellarService

# Filter by level
GET /logs?level=error

# Filter by payment
GET /logs/payment/{paymentId}

# View summary
GET /logs/summary
```

---

## Code Quality Checklist

Before committing any code:

- [ ] Used context7 to fetch official documentation
- [ ] Followed patterns from official examples
- [ ] Added logging for every major operation
- [ ] Included error context (error type, relevant IDs)
- [ ] Tests pass (if tests exist)
- [ ] TypeScript strict mode passes
- [ ] Commit message explains WHY, not just WHAT

---

## Next Phase Tasks

### 1. Actual Stellar Transaction Submission ⏳

**Documentation Source:** context7 - @stellar/stellar-sdk

**What to log:**
```typescript
// Step 1: Loading account
logger.info('[Stellar] Loading account from network', { publicKey });

// Step 2: Building transaction
logger.info('[Stellar] Building payment transaction', {
  destination,
  amount,
  baseFee,
  sequence,
});

// Step 3: Signing
logger.info('[Stellar] Signing transaction with keypair', {
  sourceAddress: sourceKeypair.publicKey(),
  operationCount: transaction.operations.length,
});

// Step 4: Submitting
logger.info('[Stellar] Submitting to Horizon server', {
  url: HORIZON_URL,
  envelope_xdr_length: xdr.length,
});

// Step 5: Success or failure
logger.info('[Stellar] Transaction submitted successfully', {
  txHash: result.hash,
  ledger: result.ledger,
  confirmationLink: result._links.transaction.href,
});
```

### 2. Transaction Confirmation Tracking ⏳

**Documentation Source:** context7 - Horizon API polling patterns

**What to log:**
```typescript
// Poll loop logging
logger.info('[Stellar] Polling transaction status', {
  paymentId,
  txHash,
  pollAttempt,
});

// Status updates
logger.info('[Stellar] Transaction confirmed', {
  paymentId,
  txHash,
  ledger,
  resultCode,
});
```

### 3. Retry Logic with Exponential Backoff ⏳

**What to log:**
```typescript
logger.warn('[Payment] Submission failed, scheduling retry', {
  paymentId,
  attempt,
  nextRetryIn: backoffMs,
  totalRetries: MAX_RETRIES,
  error: err.message,
});

logger.error('[Payment] Max retries exceeded', {
  paymentId,
  attempts: MAX_RETRIES,
  finalError: err.message,
});
```

### 4. Compliance Integration ⏳

**What to log:**
```typescript
logger.info('[Compliance] Checking payment', {
  paymentId,
  workerKycStatus,
  enterpriseKycStatus,
});

logger.warn('[Compliance] Payment blocked', {
  paymentId,
  reason: 'Worker KYC not verified',
  requiredStatus: 'verified',
});
```

### 5. Enterprise Wallet Management ⏳

**What to log:**
```typescript
logger.info('[Wallet] Loading enterprise signing credentials', {
  enterpriseId,
  walletType: 'Stellar',
});

logger.info('[Wallet] Enterprise account ready for transactions', {
  enterpriseId,
  publicKey: keypair.publicKey(),
  availableBalance: balance,
});
```

---

## Git Workflow

### Commit Message Format

```
[TYPE] Brief description per official docs

- Context7 library fetched: [library name]
- Logging added: [components logged]
- Pattern: [follows official example/custom with reason]

Changes:
- Implementation detail 1
- Implementation detail 2

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
```

### Types

- `feat` - New feature using official patterns
- `fix` - Bug fix with error logging improvements
- `refactor` - Code cleanup with better logging
- `docs` - Documentation updates
- `perf` - Performance improvements with metrics logging

---

## Review Checklist

When reviewing code/PRs:

1. **Documentation**: Was context7 used to fetch official docs?
2. **Logging**: Does every operation log appropriately?
3. **Queryability**: Can we debug issues from logs later?
4. **Error context**: Do error logs include relevant IDs and context?
5. **Type safety**: Does it pass TypeScript strict mode?
6. **Testing**: Are critical paths covered?

---

## Debugging with Logs

### Common Debugging Pattern

```bash
# 1. Get payment ID from error
PAYMENT_ID="4d47be09-9432-4445-8367-43b6239db34b"

# 2. View all logs for that payment
curl http://localhost:3002/logs/payment/$PAYMENT_ID

# 3. Search for error-level entries
curl http://localhost:3002/logs?level=error

# 4. View logs by component
curl http://localhost:3002/logs?component=StellarService

# 5. Get summary statistics
curl http://localhost:3002/logs/summary
```

---

## Library Documentation References

### Currently Integrated

- **Stellar SDK** - `/stellar/js-stellar-sdk` (v16.0.0)
  - Transaction building, signing, submission
  - Account loading, fee fetching
  - Error handling patterns

### To Be Integrated

- **Express.js** - Request/response handling patterns
- **PostgreSQL** - Connection pooling, transaction patterns
- **jsonwebtoken** - Token signing and verification patterns
- **bcryptjs** - Password hashing patterns

---

## Tips for Success

1. **Read official examples first** before writing code
2. **Copy patterns exactly**, then adapt as needed
3. **Log generously** in the implementation phase
4. **Query logs to debug**, not console.log
5. **Commit with context** about WHY you chose this pattern

---

This document is the source of truth for development practices.  
Update it as new patterns are discovered or best practices change.
