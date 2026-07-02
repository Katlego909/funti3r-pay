-- Payment Schedules
CREATE TABLE IF NOT EXISTS payment_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  run_day VARCHAR(10) NOT NULL,
  timezone VARCHAR(60) NOT NULL DEFAULT 'UTC',
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  last_run_status VARCHAR(20) CHECK (last_run_status IN ('success', 'partial', 'failed')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_schedule_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES payment_schedules(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_usd NUMERIC(12, 2) NOT NULL CHECK (amount_usd > 0),
  memo VARCHAR(28)
);

CREATE INDEX IF NOT EXISTS idx_schedules_enterprise_id ON payment_schedules(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_schedules_next_run_at ON payment_schedules(next_run_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_schedule_items_schedule_id ON payment_schedule_items(schedule_id);
