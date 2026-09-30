-- Additive customer address-book storage.
--
-- The legacy customers.address column remains a single-address object used by
-- the admin customer form. customers.addresses is the storefront's saved
-- address array. Nothing in this migration modifies existing values.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS addresses JSONB NOT NULL DEFAULT '[]';
