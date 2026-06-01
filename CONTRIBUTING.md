# Contributing to Funti3r-pay

## Before You Start

1. Read `CLAUDE.md` - Project overview & instructions
2. Read `DEVELOPMENT.md` - Code standards
3. Run `pnpm install` and `docker-compose up -d`
4. Verify setup: `curl http://localhost:3000/status`

## Workflow

### 1. Create Feature Branch
```bash
git checkout -b feature/your-feature-name
```

Branch naming:
- `feature/` - New features
- `fix/` - Bug fixes
- `refactor/` - Code cleanup
- `docs/` - Documentation
- `test/` - Tests

### 2. Make Changes

**Follow these rules:**
- TypeScript strict mode enabled
- No `any` types
- Reuse types from `@funti3r/shared-types`
- Use utilities from `@funti3r/shared-utils`
- One task per branch
- Small, focused commits

### 3. Test Locally

```bash
pnpm type-check      # Type check all
pnpm lint            # Lint code
pnpm format          # Auto-format
pnpm test            # Run tests
pnpm build           # Build all
```

### 4. Commit

```bash
git add .
git commit -m "[TYPE] Brief description

Optional longer explanation.

Closes #123"
```

Commit message format:
```
[TYPE] Short description (max 50 chars)

- Bullet point explanation
- Another point if needed

Closes #ISSUE_NUMBER
```

Valid types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

### 5. Push & Create PR

```bash
git push origin feature/your-feature-name
```

Then create PR on GitHub with:
- Clear title
- Description of changes
- Testing performed
- Screenshots (if UI changes)

## Code Standards

### TypeScript
```typescript
// ✅ Good
const user: User = await fetchUser(id);
function createPayment(amount: number): Promise<Payment> {
  // ...
}

// ❌ Bad
const user: any = await fetchUser(id);
function createPayment(amount) {
  // ...
}
```

### Error Handling
```typescript
import { ValidationError, NotFoundError } from '@funti3r/shared-utils';

// ✅ Use shared errors
if (!email) throw new ValidationError('Email required');
if (!user) throw new NotFoundError('User');

// ❌ Generic errors
throw new Error('Bad email');
```

### Logging
```typescript
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('ServiceName');
logger.info('Payment processed', { paymentId, amount });
```

### Database Access
```typescript
// ✅ Reuse database utilities
import { query, transaction } from '@funti3r/database';

const result = await query('SELECT * FROM users WHERE id = $1', [userId]);

await transaction(async (client) => {
  await client.query('INSERT ...');
  await client.query('UPDATE ...');
});
```

### Import Organization
```typescript
// 1. External packages
import express from 'express';
import { Pool } from 'pg';

// 2. Shared packages
import { User, Payment } from '@funti3r/shared-types';
import { createLogger } from '@funti3r/shared-utils';

// 3. Local imports
import { getUserById } from './services/user';
import { config } from './config';
```

## Review Process

### Checklist Before PR
- [ ] Code compiles (`pnpm build`)
- [ ] No type errors (`pnpm type-check`)
- [ ] No lint errors (`pnpm lint`)
- [ ] Tests pass (`pnpm test`)
- [ ] Code formatted (`pnpm format`)
- [ ] No secrets in commits (`.env`, keys, tokens)
- [ ] Updated relevant documentation

### What Reviewers Will Check
- Adherence to code standards
- Type safety
- Error handling
- Security (no SQL injection, XSS, etc.)
- Performance implications
- Test coverage
- Documentation updates

## Common Tasks

### Add a New Type
1. Edit `packages/shared-types/src/index.ts`
2. Export the type
3. Use in services: `import { MyType } from '@funti3r/shared-types'`

### Add a New Utility
1. Create file in `packages/shared-utils/src/`
2. Export from `packages/shared-utils/src/index.ts`
3. Use in services: `import { myUtil } from '@funti3r/shared-utils'`

### Add Dependency to Service
```bash
pnpm --filter @funti3r/payment-service add package-name
```

### Run Specific Service
```bash
pnpm --filter @funti3r/user-service dev
```

## Troubleshooting

### Port Already in Use
```bash
API_PORT=3500 pnpm --filter @funti3r/api-gateway dev
```

### Database Connection Error
```bash
docker-compose down
docker-compose up -d
```

### Build Failures
```bash
rm -rf node_modules
pnpm install
pnpm build
```

## Questions?

- Check `DEVELOPMENT.md` for patterns
- Check `ARCHITECTURE.md` for design decisions
- Check existing services for examples
- Ask in PR comments

## Recognition

Contributors will be recognized in:
- Commit history
- Release notes
- Project README (if significant)

Thank you for contributing to Funti3r-pay!
