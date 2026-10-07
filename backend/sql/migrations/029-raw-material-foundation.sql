-- Raw-material foundation: units of measure, unit conversion, batches, and the
-- per-product unit / stock-level fields.
--
-- This business supplies food raw materials to branches, so a product needs to
-- know what it is counted in (Kg, Litre, Bag) and how packs convert into the
-- stock unit. "Basmati Rice, 1 Bag = 25 Kg" is the whole reason this migration
-- exists: without it, 20 Bags and 500 Kg are two unrelated numbers.
--
-- SAFETY: additive only. No table is dropped, no column is removed, no existing
-- row is touched. Every column added to products is nullable or has a default,
-- so the 8 existing products keep working unchanged and keep their prices and
-- stock. stock_ledger stays the single system of record for movements; this
-- migration only adds the master data that movements reference.
--
-- Batch quantities are authoritative (quantity_received / quantity_remaining);
-- products.stock remains a mirror that existing code already reads, so it is not
-- derived away here.

-- ─────────────────────────────────────────────────────────────────────────────
-- Units
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per unit. dimension groups units that may convert between each other;
-- mass cannot sensibly become volume, so a conversion is only ever allowed
-- within a dimension.
CREATE TABLE IF NOT EXISTS units_of_measure (
  id          BIGSERIAL PRIMARY KEY,
  uuid        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name        TEXT NOT NULL,
  -- Short code used in the UI and on labels: kg, L, bag.
  code        TEXT NOT NULL UNIQUE,
  dimension   TEXT NOT NULL CHECK (dimension IN ('WEIGHT', 'VOLUME', 'COUNT', 'PACKAGE')),
  -- Exact (decimal) rather than real: 1 kg = 1000 g must not drift.
  quantity_in_base NUMERIC(20,8) NOT NULL DEFAULT 1 CHECK (quantity_in_base > 0),
  -- Whether quantities in this unit may be fractional. A Bag is whole; a Kg is not.
  allows_fractional BOOLEAN NOT NULL DEFAULT TRUE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS units_of_measure_dimension_idx ON units_of_measure (dimension);

-- Conversion between two units of the SAME dimension. `factor` is "how many
-- `to_unit` are in one `from_unit`", so 1 Bag -> Kg has factor 25.
CREATE TABLE IF NOT EXISTS unit_conversions (
  id          BIGSERIAL PRIMARY KEY,
  uuid        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  from_unit_id BIGINT NOT NULL REFERENCES units_of_measure(id) ON DELETE CASCADE,
  to_unit_id   BIGINT NOT NULL REFERENCES units_of_measure(id) ON DELETE CASCADE,
  factor      NUMERIC(20,8) NOT NULL CHECK (factor > 0),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unit_conversions_no_self CHECK (from_unit_id <> to_unit_id),
  -- One conversion per pair per direction. The reciprocal is derived, not stored,
  -- so the two can never disagree.
  CONSTRAINT unit_conversions_pair_key UNIQUE (from_unit_id, to_unit_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Product unit and stock-level fields
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='purchase_unit_id') THEN
    ALTER TABLE products ADD COLUMN purchase_unit_id BIGINT REFERENCES units_of_measure(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='stock_unit_id') THEN
    ALTER TABLE products ADD COLUMN stock_unit_id BIGINT REFERENCES units_of_measure(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='conversion_factor') THEN
    -- How many stock units are in one purchase unit. 1 Bag = 25 Kg -> 25.
    ALTER TABLE products ADD COLUMN conversion_factor NUMERIC(20,6) NOT NULL DEFAULT 1
      CHECK (conversion_factor > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='min_stock_level') THEN
    ALTER TABLE products ADD COLUMN min_stock_level NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (min_stock_level >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='max_stock_level') THEN
    ALTER TABLE products ADD COLUMN max_stock_level NUMERIC(18,4) CHECK (max_stock_level IS NULL OR max_stock_level >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='reorder_level') THEN
    ALTER TABLE products ADD COLUMN reorder_level NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='default_supplier_id') THEN
    ALTER TABLE products ADD COLUMN default_supplier_id BIGINT REFERENCES suppliers(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='batch_tracking') THEN
    ALTER TABLE products ADD COLUMN batch_tracking BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='expiry_tracking') THEN
    ALTER TABLE products ADD COLUMN expiry_tracking BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='hsn_code') THEN
    ALTER TABLE products ADD COLUMN hsn_code TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='is_raw_material') THEN
    -- Distinguishes a raw material from a finished/retail line without removing
    -- anything: existing rows default to FALSE and are untouched.
    ALTER TABLE products ADD COLUMN is_raw_material BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Batches
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per received batch, at a location (central warehouse or a branch).
-- quantity_remaining is authoritative: stock is the sum of live batches, so an
-- expired or blocked batch stops being available without deleting anything.
CREATE TABLE IF NOT EXISTS product_batches (
  id            BIGSERIAL PRIMARY KEY,
  uuid          UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,

  batch_number  TEXT NOT NULL,
  product_id    BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_uuid  TEXT,
  supplier_id   BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  purchase_invoice_id BIGINT REFERENCES purchase_invoices(id) ON DELETE SET NULL,
  stock_receipt_id    BIGINT REFERENCES stock_receipts(id) ON DELETE SET NULL,

  -- Where the batch physically sits. Exactly one of these two is set: a batch is
  -- either central stock or a branch's stock, never both at once.
  warehouse_id  BIGINT REFERENCES warehouses(id) ON DELETE RESTRICT,
  branch_id     BIGINT REFERENCES branches(id) ON DELETE RESTRICT,

  unit_id       BIGINT REFERENCES units_of_measure(id) ON DELETE SET NULL,

  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  manufacturing_date DATE,
  expiry_date   DATE,

  -- Quantities are always in the batch's unit_id (the stock unit).
  quantity_received NUMERIC(18,4) NOT NULL CHECK (quantity_received > 0),
  quantity_remaining NUMERIC(18,4) NOT NULL CHECK (quantity_remaining >= 0),
  quantity_reserved  NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  -- Cost as received, per unit_id. Purchase invoices keep their own rate too;
  -- this is the batch's own landed cost and is never overwritten afterwards.
  cost_price    NUMERIC(12,2) CHECK (cost_price IS NULL OR cost_price >= 0),

  status        TEXT NOT NULL DEFAULT 'AVAILABLE'
                CHECK (status IN ('AVAILABLE', 'NEAR_EXPIRY', 'EXPIRED', 'BLOCKED', 'DAMAGED', 'DEPLETED', 'RETURNED')),

  notes         TEXT,
  created_by    BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Remaining can never exceed what came in.
  CONSTRAINT product_batches_remaining_check CHECK (quantity_remaining <= quantity_received),
  -- A batch lives in exactly one place.
  CONSTRAINT product_batches_location_check CHECK (
    (warehouse_id IS NOT NULL AND branch_id IS NULL) OR
    (warehouse_id IS NULL AND branch_id IS NOT NULL)
  ),
  -- Batch numbers are unique per product, per location: two deliveries of
  -- "BR-001" to different branches are both legitimate.
  CONSTRAINT product_batches_number_key UNIQUE (product_id, branch_id, warehouse_id, batch_number)
);

CREATE INDEX IF NOT EXISTS product_batches_product_idx ON product_batches (product_id);
CREATE INDEX IF NOT EXISTS product_batches_warehouse_idx ON product_batches (warehouse_id);
CREATE INDEX IF NOT EXISTS product_batches_branch_idx ON product_batches (branch_id);
-- FEFO reads by earliest expiry, so that index is the issuing hot path.
CREATE INDEX IF NOT EXISTS product_batches_fefo_idx
  ON product_batches (product_id, warehouse_id, expiry_date)
  WHERE status = 'AVAILABLE' AND quantity_remaining > 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- Inventory settings
-- ─────────────────────────────────────────────────────────────────────────────

-- Single-row-per-scope configuration. Kept as rows rather than constants so the
-- issuing rule and the expiry warning window are changeable per deployment.
CREATE TABLE IF NOT EXISTS inventory_settings (
  id          BIGSERIAL PRIMARY KEY,
  uuid        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  -- 'GLOBAL' or a branch id, so a branch can be issued FIFO while the warehouse
  -- is FEFO.
  scope_type  TEXT NOT NULL DEFAULT 'GLOBAL' CHECK (scope_type IN ('GLOBAL', 'BRANCH')),
  scope_id    BIGINT,

  -- FEFO for perishables, FIFO where expiry does not matter.
  issuing_method TEXT NOT NULL DEFAULT 'FEFO' CHECK (issuing_method IN ('FEFO', 'FIFO')),
  -- How many days ahead counts as "near expiry" on dashboards and alerts.
  expiry_warning_days INTEGER NOT NULL DEFAULT 30 CHECK (expiry_warning_days >= 0),
  -- When true, an expired batch is excluded from issuable stock automatically.
  auto_block_expired BOOLEAN NOT NULL DEFAULT TRUE,
  -- Whether a receiving shortfall is written off automatically or held for review.
  allow_negative_stock BOOLEAN NOT NULL DEFAULT FALSE,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_settings_scope_key UNIQUE (scope_type, scope_id)
);

-- Seed the GLOBAL default. ON CONFLICT DO NOTHING keeps a re-run harmless and
-- never overwrites an operator's chosen settings.
INSERT INTO inventory_settings (scope_type, scope_id, issuing_method, expiry_warning_days)
VALUES ('GLOBAL', NULL, 'FEFO', 30)
ON CONFLICT (scope_type, scope_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Stock-level alert view
-- ─────────────────────────────────────────────────────────────────────────────

-- Not a table: products already carry min/max/reorder, and low_stock_threshold
-- predates this work. A view keeps the comparison in one place instead of
-- repeating it in every report.
CREATE OR REPLACE VIEW product_stock_levels AS
SELECT
  p.id AS product_id,
  p.uuid AS product_uuid,
  p.name AS product_name,
  p.sku,
  COALESCE(w.available_quantity, 0) AS warehouse_quantity,
  COALESCE(b.branch_quantity, 0)    AS branch_quantity,
  COALESCE(w.available_quantity, 0) + COALESCE(b.branch_quantity, 0) AS total_quantity,
  p.min_stock_level,
  p.reorder_level,
  p.max_stock_level,
  p.low_stock_threshold,
  CASE
    WHEN COALESCE(w.available_quantity, 0) + COALESCE(b.branch_quantity, 0) <= 0
      THEN 'OUT_OF_STOCK'
    WHEN COALESCE(w.available_quantity, 0) + COALESCE(b.branch_quantity, 0) <= p.reorder_level
      THEN 'REORDER_REQUIRED'
    WHEN COALESCE(w.available_quantity, 0) + COALESCE(b.branch_quantity, 0) <= p.min_stock_level
      THEN 'LOW_STOCK'
    ELSE 'OK'
  END AS stock_state
FROM products p
LEFT JOIN (
  SELECT product_id, SUM(quantity_remaining) AS available_quantity
    FROM product_batches
   WHERE warehouse_id IS NOT NULL
     AND status = 'AVAILABLE'
     AND quantity_remaining > 0
     AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
   GROUP BY product_id
) w ON w.product_id = p.id
LEFT JOIN (
  SELECT product_id, SUM(quantity_remaining) AS branch_quantity
    FROM product_batches
   WHERE branch_id IS NOT NULL
     AND status = 'AVAILABLE'
     AND quantity_remaining > 0
     AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
   GROUP BY product_id
) b ON b.product_id = p.id;