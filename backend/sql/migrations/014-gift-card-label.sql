-- A card's display name. Drives the generated art and the shopper-facing copy,
-- so "Diwali Gift Card" reads differently from a bare "Gift Card".
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT 'Gift Card';
