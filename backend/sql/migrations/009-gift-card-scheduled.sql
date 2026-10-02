-- Scheduled gift card deliveries.
--
-- A scheduled card is NOT created at purchase time. Only the intent is stored
-- here (who, how much, what they said, when), and the card plus its code come
-- into existence at delivery time.
--
-- This is deliberate. Storing the code at purchase time so it can be mailed
-- later would leave a readable plaintext code sitting in the database for
-- however long the sender picked — months, for a birthday. Here no code exists
-- until the chosen moment, so there is nothing to leak.
CREATE TABLE IF NOT EXISTS gift_card_scheduled (
  id              BIGSERIAL PRIMARY KEY,
  uuid            UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency        TEXT NOT NULL DEFAULT 'INR',
  recipient_email TEXT NOT NULL,
  recipient_name  TEXT,
  gift_message    TEXT,
  scheduled_for   TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'CANCELLED')),
  -- The card that was created when this went out, for the audit trail.
  card_uuid       UUID,
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_scheduled_uuid_key ON gift_card_scheduled(uuid);
-- The delivery worker scans for PENDING rows whose time has come.
CREATE INDEX IF NOT EXISTS gift_card_scheduled_due_idx
  ON gift_card_scheduled(scheduled_for) WHERE status = 'PENDING';
