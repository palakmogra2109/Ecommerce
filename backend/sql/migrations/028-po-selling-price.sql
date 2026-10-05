-- Makes the purchase invoice the only place a product's selling price is set.
--
-- Stock already moved here: receiving a purchase invoice is what increments
-- products.stock (migration 021's stock_ledger). Price did not -- products.price
-- was set by hand on the product form, which meant two places could disagree
-- about what something costs.
--
-- unit_cost on a purchase invoice line is what the SUPPLIER charged. Using it as
-- products.price would mean selling at cost, with no margin, so the line now
-- carries the selling price separately and that is what writes products.price.
--
-- The column is nullable. An existing invoice has no selling price recorded, and
-- an old line must stay valid; a null means "this purchase did not set a price",
-- not "price zero".
--
-- Additive and idempotent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'purchase_invoice_items' AND column_name = 'selling_price'
  ) THEN
    ALTER TABLE purchase_invoice_items
      ADD COLUMN selling_price NUMERIC(12,2)
      CHECK (selling_price IS NULL OR selling_price >= 0);
  END IF;
END;
$$;

COMMENT ON COLUMN purchase_invoice_items.selling_price IS
  'Retail price this purchase sets on the product. Null means the purchase did not set one. unit_cost remains the supplier cost.';