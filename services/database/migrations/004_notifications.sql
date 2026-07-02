-- Notifications: per-user feed of platform events, polled by the frontend every 30s.
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         VARCHAR(50) NOT NULL,
  title        VARCHAR(255) NOT NULL,
  body         TEXT        NOT NULL,
  entity_type  VARCHAR(50),
  entity_id    UUID,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON notifications(user_id);

-- Partial index for unread count queries — covers the common WHERE read_at IS NULL case.
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;
