-- 032-variant-level-inventory.sql
--
-- Extends the EXISTING variant system (products.variants JSONB, and the
-- variant_uuid / variantid columns already present on purchase_invoice_items,
-- product_batches, stock_ledger and branch_products) so stock, cost and
-- pricing can be tracked per variant.
--
-- SAFETY: this migration is strictly additive.
--   * No DROP / TRUNCATE / DELETE.
--   * No UPDATE of existing rows.
--   * No column type changes, no renames.
--   * Existing rows keep working untouched: a NULL variant_uuid continues to
--     mean "product-level", exactly as it does today.
--
-- It deliberately does NOT normalise variants into new tables. products.variants
-- is already the single source of truth (7 products, 32+ live variants), and a
-- second table would be a parallel system. Variant identity (uuid / status /
-- barcode) lives inside each variant object; see lib/services/productVariants.js.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Ledger rows can point at the exact batch that moved.
--    stock_ledger already carries variant_uuid; batch_id completes the trail
--    required for batch-level costing (FEFO / weighted average).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS batch_id bigint;

CREATE INDEX IF NOT EXISTS idx_stock_ledger_batch
  ON stock_ledger (batch_id);

-- Existing lookups are by variant; this keeps them fast.
CREATE INDEX IF NOT EXISTS idx_stock_ledger_variant
  ON stock_ledger (product_id, variant_uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Per-batch cost lookup for purchase-price history / latest cost.
--    purchase_invoice_items already stores unit_cost per line, and
--    product_batches stores cost_price per batch. Index both so the variant
--    price history endpoint does not table-scan.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_variant
  ON purchase_invoice_items (product_id, variant_uuid);

CREATE INDEX IF NOT EXISTS idx_product_batches_variant
  ON product_batches (product_id, variant_uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Variant-level stock projection.
--
--    NOTE: product_stock_levels is an existing VIEW and is left EXACTLY as it
--    is, so nothing that already reads it can change behaviour. This new view is
--    an additional read projection over the same authoritative
--    product_batches rows -- not a second store of stock. All stock movement
--    still writes only to product_batches / stock_ledger.
--
--    One row per (product, variant, location kind). variant_uuid IS NULL yields
--    the product-level total, preserving the old view's numbers.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW product_variant_stock_levels AS
SELECT
  b.product_id,
  p.uuid                AS product_uuid,
  p.name                AS product_name,
  p.sku                 AS product_sku,
  b.variant_uuid,
  v.variant_name,
  v.variant_sku,
  v.variant_status,
  CASE
    WHEN b.warehouse_id IS NOT NULL THEN 'WAREHOUSE'
    WHEN b.branch_id    IS NOT NULL THEN 'BRANCH'
    ELSE 'UNASSIGNED'
  END                   AS location_kind,
  b.warehouse_id,
  b.branch_id,
  COALESCE(SUM(b.quantity_remaining), 0::numeric)  AS quantity_available,
  COALESCE(SUM(b.quantity_reserved),  0::numeric)  AS quantity_reserved,
  COUNT(*) FILTER (WHERE b.quantity_remaining > 0)  AS batch_count,
  MIN(b.expiry_date)     AS earliest_expiry,
  CASE
    WHEN BOOL_OR(b.expiry_date IS NOT NULL AND b.expiry_date < CURRENT_DATE)
      THEN 'EXPIRED'
    WHEN COALESCE(SUM(b.quantity_remaining), 0::numeric) <= 0
      THEN 'OUT_OF_STOCK'
    ELSE 'OK'
  END                   AS stock_state
FROM product_batches b
JOIN products p
  ON p.id = b.product_id
LEFT JOIN LATERAL (
  SELECT
    e->>'name'  AS variant_name,
    e->>'sku'   AS variant_sku,
    COALESCE(e->>'status', 'ACTIVE') AS variant_status
  FROM jsonb_array_elements(COALESCE(p.variants, '[]'::jsonb)) AS e
  WHERE b.variant_uuid IS NULL
     OR e->>'uuid' = b.variant_uuid
  ORDER BY (e->>'uuid' = b.variant_uuid) DESC NULLS LAST
  LIMIT 1
) v ON TRUE
WHERE b.status = 'AVAILABLE'
  AND b.quantity_remaining > 0
GROUP BY
  b.product_id, p.uuid, p.name, p.sku, b.variant_uuid,
  v.variant_name, v.variant_sku, v.variant_status,
  b.warehouse_id, b.branch_id;