-- Supplier bank details.
--
-- Kept in its own table rather than as columns on suppliers, because a supplier
-- can have several accounts over time and across banks, and because payment
-- details change far less often than the supplier record itself. One account per
-- supplier is flagged is_primary, which is what a payout run would use.
--
-- account_number is sensitive. It is stored as entered but masked on read (only
-- the last four characters are returned in listings), and is never written to a
-- log. It is deliberately not printed in full by any error path.
--
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS supplier_bank_accounts (
  id             BIGSERIAL PRIMARY KEY,
  uuid           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  supplier_id    BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,

  account_name   TEXT NOT NULL,
  bank_name      TEXT NOT NULL,
  -- Between 6 and 20 digits, which covers Indian accounts and most foreign ones.
  account_number TEXT NOT NULL CHECK (account_number ~ '^[0-9]{6,20}$'),
  -- Letters and digits, up to 11 characters, not the exact Indian IFSC layout:
  -- this is also where a supplier's other bank identifiers land, and an\n  -- overseas account has no IFSC at all. See 025 and 027.\n  ifsc           TEXT CHECK (ifsc IS NULL OR ifsc ~ '^[A-Z0-9]{1,11}$'),
  swift_code     TEXT CHECK (swift_code IS NULL OR swift_code ~ '^[A-Z0-9]{8,11}$'),
  branch         TEXT,
  account_type   TEXT NOT NULL DEFAULT 'CURRENT'
                 CHECK (account_type IN ('SAVINGS', 'CURRENT')),

  is_primary     BOOLEAN NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  notes          TEXT,

  created_by     BIGINT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A supplier has at most one primary account. The partial unique index is what
-- makes that true: retiring the old primary and setting a new one are separate
-- statements, so the second one can transiently collide and must be done inside
-- a transaction.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_bank_accounts_one_primary_idx
  ON supplier_bank_accounts (supplier_id) WHERE is_primary;

CREATE INDEX IF NOT EXISTS supplier_bank_accounts_supplier_idx
  ON supplier_bank_accounts (supplier_id);

-- An account is not a bank account without a bank and a holder, which is why
-- account_name is NOT NULL and length-checked rather than defaulted to ''.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_bank_accounts_name_check'
      AND conrelid = 'supplier_bank_accounts'::regclass
  ) THEN
    ALTER TABLE supplier_bank_accounts
      ADD CONSTRAINT supplier_bank_accounts_name_check
      CHECK (length(btrim(account_name)) > 0 AND length(btrim(bank_name)) > 0);
  END IF;
END;
$$;

-- Bank details are edited often and viewed often, and are sensitive enough to
-- deserve their own grant rather than riding on suppliers.update.
INSERT INTO permissions (name, slug, module, description) VALUES
  ('View Supplier Bank Details',  'suppliers.bank.view',   'suppliers',
   'See supplier bank accounts and masked account numbers'),
  ('Manage Supplier Bank Details','suppliers.bank.manage', 'suppliers',
   'Add, edit and retire supplier bank accounts')
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      module = EXCLUDED.module,
      description = EXCLUDED.description;
