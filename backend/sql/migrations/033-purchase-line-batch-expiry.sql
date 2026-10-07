-- 033-purchase-line-batch-expiry.sql
--
-- Adds the per-line batch and expiry information the specification requires
-- (§34: each invoice line carries its own Batch and Expiry). Both columns are
-- nullable so existing invoices keep working untouched.
ALTER TABLE purchase_invoice_items
  ADD COLUMN IF NOT EXISTS batch_number text,
  ADD COLUMN IF NOT EXISTS expiry_date   date;
