-- A scheduled purchase must remember what was bought, so the card created at
-- delivery time carries the same value, discount, validity and provenance.
-- These belong in 011's file, but that one is already applied; the runner skips
-- it, so a new migration is the only way to apply the change.
ALTER TABLE gift_card_scheduled ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2);
ALTER TABLE gift_card_scheduled ADD COLUMN IF NOT EXISTS denomination_uuid UUID REFERENCES gift_denominations(uuid) ON DELETE SET NULL;
ALTER TABLE gift_card_scheduled ADD COLUMN IF NOT EXISTS valid_for_days INTEGER;
