-- Corrects an over-strict IFSC pattern introduced by migration 024.
--
-- 024 constrained the six branch characters to letters only:
--     ifsc ~ '^[A-Z]{4}0[A-Z]{6}$'
-- which rejects real IFSCs such as HDFC0001234 and ICIC0000001, where the branch
-- part is numeric. Every Indian bank issues at least one of those, so the
-- constraint as written made it impossible to record the bank details of most
-- suppliers.
--
-- The branch component is alphanumeric. Migration 024 is also edited to match, so
-- a fresh install gets the right shape; this migration exists because 024 has
-- already run on the live database and will not run again.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'supplier_bank_accounts'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%A-Z]{6}%'
  ) THEN
    ALTER TABLE supplier_bank_accounts DROP CONSTRAINT supplier_bank_accounts_ifsc_check;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supplier_bank_accounts_ifsc_check'
       AND conrelid = 'supplier_bank_accounts'::regclass
  ) THEN
    ALTER TABLE supplier_bank_accounts
      ADD CONSTRAINT supplier_bank_accounts_ifsc_check
      CHECK (ifsc IS NULL OR ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$');
  END IF;
END;
$$;
