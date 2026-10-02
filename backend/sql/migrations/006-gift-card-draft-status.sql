-- Add the DRAFT lifecycle state introduced by the full gift card spec.
-- 005 already ran on the live database, so the status CHECK is widened here
-- instead of being edited in place. Idempotent and additive: no data is
-- rewritten, no card changes status.
ALTER TABLE gift_cards DROP CONSTRAINT IF EXISTS gift_cards_status_check;
ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_status_check
  CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'REDEEMED'));

-- A DRAFT card is not yet sellable/redeemable; new cards default to DRAFT so
-- they must be explicitly activated (purchased cards activate on payment).
ALTER TABLE gift_cards ALTER COLUMN status SET DEFAULT 'DRAFT';

-- Sellable cards are the ones checkout scans.
CREATE INDEX IF NOT EXISTS gift_cards_active_idx ON gift_cards(status, expires_at);
