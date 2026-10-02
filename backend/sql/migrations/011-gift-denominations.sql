-- Gift card denomination catalogue.
--
-- A denomination is a product the shopper can buy: the face value the recipient
-- ends up with, and optionally a lower selling price. Selling a Rs 399 card for
-- Rs 340 is a promotion, not a different product.
--
-- Single brand by design: every card here is redeemable in our own store, so it
-- plugs straight into the existing wallet and checkout path.
CREATE TABLE IF NOT EXISTS gift_denominations (
  id             BIGSERIAL PRIMARY KEY,
  uuid           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  label          TEXT NOT NULL,
  -- What the recipient's card is worth.
  face_value     NUMERIC(12,2) NOT NULL CHECK (face_value > 0),
  -- What the buyer pays. NULL or equal to face_value means no discount.
  selling_price  NUMERIC(12,2) CHECK (selling_price > 0),
  -- Blank means the card never expires.
  valid_for_days INTEGER CHECK (valid_for_days > 0),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A price above the face value is a mistake that would silently overcharge.
  CONSTRAINT gift_denominations_price_check CHECK (selling_price IS NULL OR selling_price <= face_value)
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_denominations_uuid_key ON gift_denominations(uuid);
CREATE INDEX IF NOT EXISTS gift_denominations_active_idx ON gift_denominations(is_active, sort_order);

-- What the buyer actually paid, kept on the card so a discounted sale is
-- auditable after the fact. initial_amount remains the face value: that is the
-- balance the recipient gets.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2);
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS denomination_uuid UUID REFERENCES gift_denominations(uuid) ON DELETE SET NULL;

-- Seed a small catalogue so the shop page is not empty on first run.
INSERT INTO gift_denominations (label, face_value, selling_price, valid_for_days, sort_order)
VALUES
  ('Gift Card', 250.00,  NULL, 365, 10),
  ('Gift Card', 500.00,  NULL, 365, 20),
  ('Gift Card', 1000.00, NULL, 365, 30),
  ('Gift Card', 2500.00, NULL, 365, 40)
ON CONFLICT DO NOTHING;

