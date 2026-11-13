-- When the user last signed in through an emailed recovery link (user-service POST /auth/recovery/verify).
-- Recovery skips the passkey, so whoever controls the inbox gets a session. For a while afterwards that session
-- may not move money out of the account (payment-service lib/recoveryHold.ts).
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovered_at TIMESTAMPTZ;
