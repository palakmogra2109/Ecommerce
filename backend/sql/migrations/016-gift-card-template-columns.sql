-- gift_cards becomes the TEMPLATE: the admin-managed thing a shopper buys,
-- rather than the issued card itself.
--
-- Until now one row was both the product listing and the gift, which is why a
-- template could not describe itself without also claiming to be spendable
-- stock. These columns give the template its own vocabulary — how long it lasts,
-- when it may be sold, how much one order may take — while the issued-card
-- columns (code, balance, recipient_email, applicable_*) stay exactly where they
-- are. They are still correct for the cards already issued, and leaving them
-- makes this rollback possible: if the backfill goes wrong, the old shape still
-- describes the old rows.

-- Shown on the storefront card and in the admin list, so a shopper can tell
-- "Rs 500 Diwali card" from "Rs 500 card".
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

-- The sell gate, separate from `status`. A card can be paused for a fraud
-- review or an inventory correction without losing the DRAFT/ACTIVE/ARCHIVED
-- history that `status` records, and admin list filters that used to be written
-- as a status test can be written as this instead. Once the status vocabulary is
-- retired in the data-migration step, this becomes the only gate.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- How long a code issued from this template stays valid. NULL or 0 means it
-- never expires; the value is copied onto the code's expires_at at issue time
-- because a template's validity changing later must not silently rewrite the
-- expiry of a gift someone is already holding.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS validity_days INTEGER;

-- The window the template itself may be sold in — a Diwali card that appears in
-- October and vanishes in November. Distinct from expires_at, which is about
-- how long the issued code lasts.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

-- Optional caps. NULL means no cap, which is why these are nullable rather
-- than 0: "unlimited" and "nothing allowed" must not read the same.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS per_order_limit NUMERIC(12,2);
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS max_quantity_per_order INTEGER;

-- Templates sold at one fixed value, alongside the older per-denomination
-- selling_price. NULL means the value is not fixed by the template.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS face_value NUMERIC(12,2);

-- The CHECKs are added through guarded DO blocks rather than inline, because
-- ADD COLUMN IF NOT EXISTS already skips the columns on a re-run and a bare
-- ADD CONSTRAINT would then fail on the second run with a duplicate-object
-- error. Each block asks pg_constraint first, so applying this file twice is a
-- no-op the same way CREATE TABLE IF NOT EXISTS is.
DO $$
BEGIN
  -- 0 or negative days would issue codes that are already expired on arrival.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'gift_cards'::regclass
       AND conname = 'gift_cards_validity_days_check'
  ) THEN
    ALTER TABLE gift_cards
      ADD CONSTRAINT gift_cards_validity_days_check CHECK (validity_days > 0);
  END IF;
END $$;

DO $$
BEGIN
  -- A cap of zero cards per order is a sellable card nobody can buy; the admin
  -- form means "leave it blank" for no cap.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'gift_cards'::regclass
       AND conname = 'gift_cards_max_quantity_per_order_check'
  ) THEN
    ALTER TABLE gift_cards
      ADD CONSTRAINT gift_cards_max_quantity_per_order_check CHECK (max_quantity_per_order > 0);
  END IF;
END $$;

DO $$
BEGIN
  -- A window that ends before it starts can never be sold. Half-open windows
  -- stay legal: an unbounded start or end means the template is simply open on
  -- that side.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'gift_cards'::regclass
       AND conname = 'gift_cards_sell_window_check'
  ) THEN
    ALTER TABLE gift_cards
      ADD CONSTRAINT gift_cards_sell_window_check
      CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at);
  END IF;
END $$;

-- Storefront listings filter on the sell gate, and the cleanup sweep that finds
-- templates whose window has closed reads ends_at directly.
CREATE INDEX IF NOT EXISTS gift_cards_is_active_idx ON gift_cards(is_active);
CREATE INDEX IF NOT EXISTS gift_cards_ends_at_idx ON gift_cards(ends_at);

-- DEFERRED ON PURPOSE: the template status constraint ('DRAFT' / 'ACTIVE' /
-- 'ARCHIVED').
--
-- gift_cards_status_check currently admits DRAFT, ACTIVE, SUSPENDED, CANCELLED
-- and REDEEMED, and the live table holds rows in REDEEMED, CANCELLED and
-- ACTIVE. Narrowing it to the three template states would need the drop/add
-- dance below, and it would also reject the very rows this migration is
-- required to preserve: CANCELLED and REDEEMED describe issued cards that still
-- exist, and no template vocabulary can hold them.
--
-- Replacing the constraint here would mean asserting that every one of those
-- live rows has already been migrated, which is not true yet and is not this
-- migration's job to assume. So the status CHECK is left untouched, and
-- 'ARCHIVED' is knowingly not permitted yet.
--
-- Deferred to the data-migration step, which must, in this order: move the
-- issued cards out into gift_card_codes, retemplate what remains, and only then
-- DROP CONSTRAINT gift_cards_status_check and add
--   CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')).
-- Until that step runs, DRAFT and ACTIVE are already accepted by the existing
-- constraint, so a template can be created and activated today; ARCHIVED cannot
-- be set yet, and nothing writes it until the migration lands.