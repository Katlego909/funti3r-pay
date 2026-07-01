CREATE TABLE IF NOT EXISTS worker_invites (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       VARCHAR(255) NOT NULL,
  token       VARCHAR(64)  NOT NULL UNIQUE,
  status      VARCHAR(20)  NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'expired')),
  created_at  TIMESTAMP   NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMP   NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);

CREATE INDEX idx_worker_invites_token        ON worker_invites(token);
CREATE INDEX idx_worker_invites_enterprise   ON worker_invites(enterprise_id);
CREATE INDEX idx_worker_invites_email        ON worker_invites(email);
