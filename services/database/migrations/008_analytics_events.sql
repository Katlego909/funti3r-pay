-- Analytics event log, replacing the MongoDB `events` collection. Partitioned
-- by timestamp because this table's growth is unbounded (one row per user
-- action, indefinitely) unlike every other table in this schema, which grows
-- with a bounded business entity (one row per payment, per schedule, etc.).
-- Retrofitting partitioning onto an already-populated table requires building
-- a new partitioned table and backfilling while writes continue — doing it
-- now, with zero rows, avoids that entirely.

CREATE TABLE IF NOT EXISTS events (
  id          UUID NOT NULL DEFAULT gen_random_uuid(),
  type        VARCHAR(100) NOT NULL,
  user_id     UUID,
  data        JSONB NOT NULL DEFAULT '{}',
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE INDEX IF NOT EXISTS idx_events_type_timestamp ON events(type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_user_timestamp ON events(user_id, timestamp DESC) WHERE user_id IS NOT NULL;

-- Safety net: catches any row whose timestamp falls outside every provisioned
-- monthly range (e.g. the maintenance cron falling behind), so inserts never
-- hard-fail with "no partition found."
CREATE TABLE IF NOT EXISTS events_default PARTITION OF events DEFAULT;

-- Bootstrap partitions: current month + 2 ahead. services/analytics-service's
-- ensureFuturePartitions() keeps this rolling forward monthly at runtime.
CREATE TABLE IF NOT EXISTS events_y2026m07 PARTITION OF events FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS events_y2026m08 PARTITION OF events FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS events_y2026m09 PARTITION OF events FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
