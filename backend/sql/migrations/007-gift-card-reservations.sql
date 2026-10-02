-- Gift card reservations.
--
-- A reservation holds value on a card while payment for an order is in
-- flight, so two shoppers checking out with the same card cannot both spend
-- the same balance. Reservations are separate from gift_cards.balance:
-- spendable balance = balance - SUM(active reservations).
--
-- RESERVED becomes CONSUMED when the order commits the redemption, and RELEASED
-- on payment failure, timeout, or order cancellation. Nothing is deleted, so
-- the trail survives a refund.
CREATE TABLE IF NOT EXISTS gift_card_reservations (
  id             BIGSERIAL PRIMARY KEY,
  uuid           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  gift_card_id   BIGINT NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  order_uuid     UUID,
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status         TEXT NOT NULL DEFAULT 'RESERVED'
                 CHECK (status IN ('RESERVED', 'CONSUMED', 'RELEASED', 'EXPIRED')),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '15 minutes'),
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_reservations_uuid_key ON gift_card_reservations(uuid);
CREATE INDEX IF NOT EXISTS gift_card_reservations_card_idx ON gift_card_reservations(gift_card_id, status);
CREATE INDEX IF NOT EXISTS gift_card_reservations_order_idx ON gift_card_reservations(order_uuid);
CREATE INDEX IF NOT EXISTS gift_card_reservations_expiry_idx ON gift_card_reservations(status, expires_at);

-- One live reservation per order: a retry of the same checkout reuses the
-- existing hold instead of stacking a second one on the same balance.
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_reservations_active_order_key
  ON gift_card_reservations(order_uuid)
  WHERE status = 'RESERVED' AND order_uuid IS NOT NULL;
