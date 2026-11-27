-- Items of a payout batch that never became a payment: they failed a check before anything was sent (the worker is not
-- on the company's team, their KYC is not verified, their account is missing, the currency is unsupported). They have
-- no payments row, so their reasons were lost once the batch answered. Each entry: {workerId, amountUsd, reason}.
ALTER TABLE payment_batches ADD COLUMN IF NOT EXISTS unsent JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Why a payroll schedule's last run failed (only kept in the log before), and the batch it produced, if any.
ALTER TABLE payment_schedules ADD COLUMN IF NOT EXISTS last_run_error TEXT;
ALTER TABLE payment_schedules ADD COLUMN IF NOT EXISTS last_run_batch_id UUID REFERENCES payment_batches(id) ON DELETE SET NULL;
