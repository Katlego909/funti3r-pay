-- One append-only trail of every action that moves money or changes who may: escrow create / approve / claim / refund /
-- freeze, work submitted and sent back, payouts, cash-outs. "Who did what to which record, when, from which request",
-- readable after the fact and impossible to edit: the table refuses UPDATE, DELETE and TRUNCATE for everyone.
-- No foreign keys on purpose, so the trail outlives the rows it describes.

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id UUID,
  actor_role VARCHAR(20) NOT NULL,
  action VARCHAR(60) NOT NULL,
  entity_type VARCHAR(30) NOT NULL,
  entity_id TEXT NOT NULL,
  detail JSONB,
  request_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events (entity_type, entity_id, at);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events (actor_id, at DESC);

CREATE OR REPLACE FUNCTION forbid_audit_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_change();

DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_change();
