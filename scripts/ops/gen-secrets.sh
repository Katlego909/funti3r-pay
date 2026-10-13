#!/usr/bin/env bash
# Prints fresh random values for the secrets a NEW deployment needs. Nothing is written to disk: copy the output into the
# server's environment file (never into git).
#
# Not for an existing deployment's MASTER_ENCRYPTION_KEY: wallet secrets and KYC data are encrypted with it, so changing it
# without re-encrypting makes them unreadable. Use services/payment-service/scripts/rotate-keys.ts for that.
set -euo pipefail

hex()  { node -e "process.stdout.write(require('crypto').randomBytes($1).toString('hex'))"; }
pass() { node -e "process.stdout.write(require('crypto').randomBytes($1).toString('base64url'))"; }

cat <<VALUES
JWT_SECRET=$(hex 48)
INTERNAL_AUTH_SECRET=$(hex 48)
MASTER_ENCRYPTION_KEY=$(hex 32)
POSTGRES_PASSWORD=$(pass 24)
REDIS_PASSWORD=$(pass 24)
VALUES

cat >&2 <<'NOTE'

Keep MASTER_ENCRYPTION_KEY in two separate places (for example a password manager and an offline copy held by a second
person). If it is lost, every encrypted wallet secret and KYC record is unrecoverable; if it leaks, they are all exposed.
Also set NODE_ENV=production, leave ENABLE_DEV_LOGIN unset, and keep COMPLIANCE_AUTO_APPROVE=false.
NOTE
