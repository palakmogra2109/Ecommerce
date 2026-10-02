-- Wallet buckets.
--
-- A wallet balance is not one number. It is a set of buckets, each the
-- remainder of a single claim, and each carrying the applicability it inherited
-- from the card it came from. Money from a spices-only card may only pay for
-- spices, so "the wallet has 1500" is not a usable statement: the shopper has
-- 1000 of spices-only money and 500 that is free to go anywhere, and only the
-- second pot can cover a rice order.
--
-- Why this is a table and not a column or some JSON. The design note originally
-- put the bucket in customer_reward_transactions.metadata. That cannot work for
-- spending, because a refund has to return value to the *same* bucket the debit
-- came from, and a metadata blob has no identity to point at. The ledger's
-- bucket_id column was left dangling waiting for exactly this table. One row per
-- claim, with the ledger as the audit trail of how it got there.
--
-- remaining is the live spendable value. It is denormalised on purpose: a
-- checkout must decide which buckets to draw from while holding locks, and
-- re-deriving the balance by summing the ledger under those locks is both slower
-- and easier to get subtly wrong. The CHECK below is the real guard -- a bucket
-- can never go negative even if application arithmetic is wrong, and the
-- overdraw guard on the ledger is the second line.
CREATE TABLE IF NOT EXISTS customer_wallet_buckets (
  id             BIGSERIAL PRIMARY KEY,
  uuid           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  wallet_id      BIGINT NOT NULL REFERENCES customer_wallets(id) ON DELETE CASCADE,
  -- The claim that opened this bucket. ON DELETE SET NULL rather than CASCADE:
  -- revoking a code must never silently delete the value a customer already
  -- spent or holds, it has to be reversed through the ledger instead.
  code_id        BIGINT REFERENCES gift_card_codes(id) ON DELETE SET NULL,
  currency       TEXT NOT NULL DEFAULT 'INR',
  -- The value this bucket started with, for audit and for the refund cap.
  initial_value  NUMERIC(12,2) NOT NULL CHECK (initial_value >= 0),
  remaining      NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- The applicability inherited at claim time: empty array means unrestricted.
  -- Frozen here rather than joined from the template on read, because an admin
  -- editing a template's scope must never retroactively change the terms a
  -- customer already redeemed under.
  applicability  JSONB NOT NULL DEFAULT '[]',
  expires_at     TIMESTAMPTZ,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A bucket cannot be overdrawn, and cannot hold more than it was issued.
  -- These two are the database-level reason a customer's balance is trustworthy.
  CONSTRAINT customer_wallet_buckets_remaining_check CHECK (remaining >= 0),
  CONSTRAINT customer_wallet_buckets_remaining_cap CHECK (remaining <= initial_value)
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_wallet_buckets_uuid_key
  ON customer_wallet_buckets(uuid);
-- One live bucket per claim. A code is claimed once, so it can only ever open
-- one bucket; this makes a double-credit impossible at the storage layer rather
-- than relying on the claim service to be careful.
CREATE UNIQUE INDEX IF NOT EXISTS customer_wallet_buckets_code_key
  ON customer_wallet_buckets(code_id)
  WHERE code_id IS NOT NULL AND is_active;
CREATE INDEX IF NOT EXISTS customer_wallet_buckets_wallet_idx
  ON customer_wallet_buckets(wallet_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS customer_wallet_buckets_expiry_idx
  ON customer_wallet_buckets(expires_at) WHERE is_active;

-- Wire up the column that has been dangling since 015. ON DELETE SET NULL keeps
-- the ledger row intact if a bucket is ever removed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_reward_transactions_bucket_id_fkey'
      AND conrelid = 'customer_reward_transactions'::regclass
  ) THEN
    ALTER TABLE customer_reward_transactions
      ADD CONSTRAINT customer_reward_transactions_bucket_id_fkey
      FOREIGN KEY (bucket_id) REFERENCES customer_wallet_buckets(id) ON DELETE SET NULL;
  END IF;
END;
$$;
