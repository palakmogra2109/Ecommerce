-- Goods receipts needed their own document series, and the seeded formats double
-- counted the prefix.
--
-- Two defects, both in invoice_sequences as migration 021 seeded it:
--
--  1. STOCK_RECEIPT was not a valid entity, but a goods receipt is a numbered
--     document like any other — a supplier dispute is settled by receipt number.
--
--  2. format was seeded as 'PI-%s' while prefix was also 'PI-', so rendering
--     the sequence produced PI-PI-000001. prefix is the one place a series
--     carries its label, so format should just place the value.
--
-- Additive and idempotent. Existing sequences are repaired in place rather than
-- re-seeded, so any numbering already issued stays continuous.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'invoice_sequences_entity_check'
       AND conrelid = 'invoice_sequences'::regclass
  ) THEN
    -- recreate the CHECK with STOCK_RECEIPT admitted
    EXECUTE 'ALTER TABLE invoice_sequences DROP CONSTRAINT invoice_sequences_entity_check';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'invoice_sequences_entity_check'
       AND conrelid = 'invoice_sequences'::regclass
       AND pg_get_constraintdef(oid) NOT LIKE '%STOCK_RECEIPT%'
  ) THEN
    ALTER TABLE invoice_sequences DROP CONSTRAINT invoice_sequences_entity_check;
    ALTER TABLE invoice_sequences ADD CONSTRAINT invoice_sequences_entity_check
      CHECK (entity IN (
        'PURCHASE_INVOICE', 'PURCHASE_RETURN', 'SALES_INVOICE',
        'SALES_RETURN', 'CREDIT_NOTE', 'STOCK_TRANSFER', 'STOCK_RECEIPT'
      ));
  END IF;
END;
$$;

-- format becomes just the placeholder; prefix supplies the label exactly once.
UPDATE invoice_sequences SET format = '%s' WHERE format <> '%s';

INSERT INTO invoice_sequences (entity, series, prefix, format, padding)
VALUES ('STOCK_RECEIPT', 'DEFAULT', 'GR-', '%s', 6)
ON CONFLICT (entity, series, financial_year) DO NOTHING;
