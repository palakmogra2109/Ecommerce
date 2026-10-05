-- Relaxes the IFSC column from the exact Indian IFSC layout to letters-and-digits.
--
-- 025 corrected the branch component from letters-only to alphanumeric, which
-- fixed HDFC0001234. It kept the stricter surrounding shape:
--     ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'
-- That still rejects legitimate values, e.g. FD433424244 -- eleven characters and
-- alphanumeric, just not laid out as an Indian IFSC. Suppliers outside India have
-- no IFSC at all, and some domestic entries are bank codes rather than IFSCs.
--
-- Refusing these left no way to record how to pay a supplier, which blocks every
-- later purchase run. The column now accepts 1-11 letters and digits. Code that
-- needs the exact shape (sending an instruction to an Indian gateway) should
-- validate at that boundary rather than at data entry.
--
-- Idempotent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supplier_bank_accounts_ifsc_check'
       AND conrelid = 'supplier_bank_accounts'::regclass
  ) THEN
    ALTER TABLE supplier_bank_accounts DROP CONSTRAINT supplier_bank_accounts_ifsc_check;
  END IF;
END;
$$;

ALTER TABLE supplier_bank_accounts
  ADD CONSTRAINT supplier_bank_accounts_ifsc_check
  CHECK (ifsc IS NULL OR ifsc ~ '^[A-Z0-9]{1,11}$');
