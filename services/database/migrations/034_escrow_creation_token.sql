-- The token an escrow creation locks. New escrows lock USDC; creations recorded before this were native XLM, which
-- is what the default fills in for them. The reconciler copies it into escrows.token_code when it records a creation.
ALTER TABLE escrow_creations ADD COLUMN IF NOT EXISTS token_code VARCHAR(12) NOT NULL DEFAULT 'XLM';
