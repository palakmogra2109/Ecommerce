-- Full gift card system: secure code storage, card types/sources, usage and
-- applicability rules, ledger audit fields, cancellation-friendly statuses.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Additive: only new columns, widened CHECKs, and data backfill. The single
-- live row keeps working through the legacy plaintext-code fallback.

-- New-code storage: hash + last4. `code` turns nullable; rows created from
-- here on keep it NULL and are found by hash.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS code_hash TEXT;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS code_last4 TEXT;
ALTER TABLE gift_cards ALTER COLUMN code DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_code_hash_key ON gift_cards(code_hash);

ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'FIXED';
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS usage_limit INTEGER;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS min_order_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS max_redemption_amount NUMERIC(12,2);
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS applicable_branches JSONB NOT NULL DEFAULT '[]';
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS applicable_products JSONB NOT NULL DEFAULT '[]';
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS applicable_categories JSONB NOT NULL DEFAULT '[]';
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL;

-- INACTIVE becomes SUSPENDED; CANCELLED joins as a terminal state.
-- REDEEMED keeps meaning fully-used. Expiry stays derived from expires_at.
UPDATE gift_cards SET status = 'SUSPENDED', updated_at = now() WHERE status = 'INACTIVE';

ALTER TABLE gift_cards DROP CONSTRAINT IF EXISTS gift_cards_status_check;
ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_status_check
  CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CANCELLED', 'REDEEMED'));

-- Backfill hash + last4 for pre-hash rows so both lookups converge.
UPDATE gift_cards
SET code_hash = encode(digest(upper(regexp_replace(code, '\s+', '-', 'g')), 'sha256'), 'hex'),
    code_last4 = right(regexp_replace(code, '[^A-Za-z0-9]', '', 'g'), 4),
    updated_at = now()
WHERE code_hash IS NULL AND code IS NOT NULL;

-- Ledger audit fields (spec: before/after, who, why).
ALTER TABLE gift_card_transactions ADD COLUMN IF NOT EXISTS balance_before NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE gift_card_transactions ADD COLUMN IF NOT EXISTS performed_by TEXT;
ALTER TABLE gift_card_transactions ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE gift_card_transactions ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

ALTER TABLE gift_card_transactions DROP CONSTRAINT IF EXISTS gift_card_transactions_type_check;
ALTER TABLE gift_card_transactions ADD CONSTRAINT gift_card_transactions_type_check
  CHECK (type IN ('ISSUE', 'PURCHASED', 'ACTIVATED', 'REDEEM', 'REFUND', 'REVERSAL', 'ADJUSTMENT', 'EXPIRED', 'CANCELLED'));
