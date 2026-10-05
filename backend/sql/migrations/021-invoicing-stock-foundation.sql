-- ============================================================================
-- 021 — Invoicing and stock management foundation
-- ----------------------------------------------------------------------------
-- The purchase/invoice/stock-transfer system needs tables that do not exist:
-- suppliers, a warehouse, purchase invoices and their lines, supplier
-- payments, goods receipts, sales invoices and their lines, and an audit log.
--
-- What is NOT touched here, deliberately:
--   branch_products, branch_stock_transfers, branch_transfer_items and
--   branch_inventory_transactions already exist and already work. They use a
--   folded-lowercase convention (stockquantity, sourcebranchid) documented in
--   sql/inventory.md, which `npm run verify:phase1` checks against the live
--   schema. Changing them is a separate, riskier migration; this one only
--   adds tables alongside them. See 022.
--
-- New tables use snake_case, matching orders/users and the gift-card tables
-- added in 015-020, rather than the folded style of the older branch_* tables.
--
-- Everything is additive and idempotent. No existing row is read or written.
-- ============================================================================

-- ── Parties ────────────────────────────────────────────────────────────────

-- A supplier is a party we BUY from. Distinct from branches, which we own.
-- gstin is nullable and not validated here: registration and tax treatment
-- are business configuration, and an unregistered supplier buying under a
-- reverse charge is legitimate.
CREATE TABLE IF NOT EXISTS suppliers (
  id            BIGSERIAL PRIMARY KEY,
  uuid          UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name          TEXT NOT NULL,
  contact_name  TEXT,
  email         TEXT,
  phone         TEXT,
  address       TEXT,
  city          TEXT,
  state         TEXT,
  postal_code   TEXT,
  country       TEXT NOT NULL DEFAULT 'IN',
  gstin         TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 0
                CHECK (payment_terms_days >= 0),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  notes         TEXT,
  created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS suppliers_active_idx ON suppliers(is_active, name);
-- Case-insensitive uniqueness, so "Acme Ltd" and "ACME LTD" cannot both exist
-- and split their invoice history.
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_email_key
  ON suppliers (lower(email)) WHERE email IS NOT NULL;

-- A warehouse holds stock. Seeded with the central warehouse, which is the
-- source for every transfer; branches are represented by branches + the
-- existing branch_products, NOT by warehouse rows, so one place cannot claim
-- to be both a warehouse and a branch.
CREATE TABLE IF NOT EXISTS warehouses (
  id            BIGSERIAL PRIMARY KEY,
  uuid          UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name          TEXT NOT NULL,
  code          TEXT NOT NULL UNIQUE,
  -- 'CENTRAL' or 'BRANCH'. A BRANCH warehouse mirrors the branch's stock in
  -- branch_products; the row exists so stock documents can name a location
  -- uniformly instead of special-casing branches everywhere.
  kind          TEXT NOT NULL DEFAULT 'CENTRAL'
                CHECK (kind IN ('CENTRAL', 'BRANCH')),
  branch_id     BIGINT REFERENCES branches(id) ON DELETE CASCADE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A BRANCH warehouse must name its branch, and a CENTRAL one must not.
  CONSTRAINT warehouses_branch_shape_check CHECK (
    (kind = 'BRANCH' AND branch_id IS NOT NULL) OR
    (kind = 'CENTRAL' AND branch_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_branch_key
  ON warehouses (branch_id) WHERE branch_id IS NOT NULL;

-- One central warehouse. ON CONFLICT DO NOTHING so re-running is safe and
-- never renumbers it under a purchase invoice that already points at it.
INSERT INTO warehouses (name, code, kind)
VALUES ('Central Warehouse', 'CENTRAL', 'CENTRAL')
ON CONFLICT (code) DO NOTHING;

-- ── Numbering ──────────────────────────────────────────────────────────────

-- Configurable document numbering, because invoice numbers are a legal
-- requirement, not a formatting preference: a B2C retail run and a B2B run
-- usually must use different series, and the format is set per business.
-- Keyed by (entity, series) so a series can be reopened per financial year.
CREATE TABLE IF NOT EXISTS invoice_sequences (
  id            BIGSERIAL PRIMARY KEY,
  entity        TEXT NOT NULL
                CHECK (entity IN (
                  'PURCHASE_INVOICE', 'PURCHASE_RETURN', 'SALES_INVOICE',
                  'SALES_RETURN', 'CREDIT_NOTE', 'STOCK_TRANSFER'
                )),
  series        TEXT NOT NULL DEFAULT 'DEFAULT',
  prefix        TEXT NOT NULL DEFAULT '',
  -- %s is the running number, so 'INV-%s' renders INV-000001.
  format        TEXT NOT NULL DEFAULT '%s',
  next_value    BIGINT NOT NULL DEFAULT 1 CHECK (next_value > 0),
  padding       INTEGER NOT NULL DEFAULT 6 CHECK (padding BETWEEN 0 AND 12),
  financial_year TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoice_sequences_scope_key UNIQUE (entity, series, financial_year)
);

INSERT INTO invoice_sequences (entity, series, prefix, format, padding)
VALUES
  ('PURCHASE_INVOICE', 'DEFAULT', 'PI-',  'PI-%s', 6),
  ('PURCHASE_RETURN',  'DEFAULT', 'PR-',  'PR-%s', 6),
  ('SALES_INVOICE',    'DEFAULT', 'SI-',  'SI-%s', 6),
  ('SALES_RETURN',     'DEFAULT', 'SR-',  'SR-%s', 6),
  ('CREDIT_NOTE',      'DEFAULT', 'CN-',  'CN-%s', 6),
  -- Deliberately a document number and NOT a tax invoice: an internal stock
  -- movement is not a supply of goods to a customer and must not be numbered
  -- from the sales-invoice series. The spec calls this out explicitly.
  ('STOCK_TRANSFER',   'DEFAULT', 'ST-',  'ST-%s', 6)
ON CONFLICT (entity, series, financial_year) DO NOTHING;

-- Tax configuration, so tax treatment is data rather than hard-coded logic.
CREATE TABLE IF NOT EXISTS tax_rates (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  rate          NUMERIC(6,3) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  -- inclusive means the rate is already inside the price.
  is_inclusive  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Business tax registration. A stock transfer document is not automatically a
-- tax invoice, so the decision lives here in configuration rather than in a
-- hard-coded branch in the transfer flow.
CREATE TABLE IF NOT EXISTS tax_registrations (
  id            BIGSERIAL PRIMARY KEY,
  legal_name    TEXT NOT NULL,
  gstin         TEXT,
  pan           TEXT,
  state_code    TEXT,
  address       TEXT,
  is_default    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tax_registrations_gstin_key
  ON tax_registrations (gstin) WHERE gstin IS NOT NULL;

-- ── Purchase invoices ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS purchase_invoices (
  id                    BIGSERIAL PRIMARY KEY,
  uuid                  UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  invoice_number        TEXT NOT NULL UNIQUE,
  -- The supplier's own number. A supplier may reissue a number after a
  -- correction, so uniqueness is on (supplier, supplier_invoice_number) and
  -- NOT globally — that is what actually prevents a double payment.
  supplier_invoice_number TEXT NOT NULL,
  supplier_id           BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  invoice_date          DATE NOT NULL,
  due_date              DATE,
  -- The document's own lifecycle. Payment state is a separate concern and
  -- lives on payment_status, because "Received" and "Paid" are independent:
  -- goods can land before the money does, or never.
  status                TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'AWAITING_STOCK', 'PARTIALLY_RECEIVED',
                      'RECEIVED', 'CANCELLED')),
  payment_status        TEXT NOT NULL DEFAULT 'UNPAID'
    CHECK (payment_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')),
  warehouse_id          BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  subtotal              NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total             NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  shipping_total        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (shipping_total >= 0),
  total_amount          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  currency              TEXT NOT NULL DEFAULT 'INR',
  tax_rate_id           BIGINT REFERENCES tax_rates(id) ON DELETE SET NULL,
  -- The supplier's document, kept for dispute resolution. No file is stored
  -- in the database: the path only, so uploads can live in object storage.
  attachment_path       TEXT,
  attachment_name       TEXT,
  attachment_mime       TEXT,
  notes                 TEXT,
  is_return             BOOLEAN NOT NULL DEFAULT FALSE,
  created_by            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at          TIMESTAMPTZ,
  cancel_reason         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The real double-entry guard, scoped to the supplier so two suppliers may
  -- legitimately both use "INV-001".
  CONSTRAINT purchase_invoices_supplier_number_key
    UNIQUE (supplier_id, supplier_invoice_number),
  -- A due date before the invoice date is always a data-entry error.
  CONSTRAINT purchase_invoices_dates_check
    CHECK (due_date IS NULL OR due_date >= invoice_date),
  -- A cancelled invoice has to say why, and must not be quietly reopened:
  -- re-cancelling is refused by the guard below.
  CONSTRAINT purchase_invoices_cancel_check
    CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS purchase_invoices_supplier_idx
  ON purchase_invoices (supplier_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS purchase_invoices_status_idx
  ON purchase_invoices (status);
CREATE INDEX IF NOT EXISTS purchase_invoices_payment_status_idx
  ON purchase_invoices (payment_status);
CREATE INDEX IF NOT EXISTS purchase_invoices_date_idx
  ON purchase_invoices (invoice_date DESC);

CREATE TABLE IF NOT EXISTS purchase_invoice_items (
  id                BIGSERIAL PRIMARY KEY,
  uuid              UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  purchase_invoice_id BIGINT NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  line_no           INTEGER NOT NULL CHECK (line_no > 0),
  product_id        BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_uuid      TEXT,
  sku               TEXT NOT NULL DEFAULT '',
  name              TEXT NOT NULL,
  barcode           TEXT,
  quantity_ordered      NUMERIC(14,3) NOT NULL CHECK (quantity_ordered > 0),
  quantity_received     NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  quantity_damaged      NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_damaged >= 0),
  quantity_rejected     NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_rejected >= 0),
  unit_cost         NUMERIC(14,4) NOT NULL CHECK (unit_cost >= 0),
  discount_percent  NUMERIC(6,3) NOT NULL DEFAULT 0
                     CHECK (discount_percent >= 0 AND discount_percent <= 100),
  discount_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_percent       NUMERIC(6,3) NOT NULL DEFAULT 0
                     CHECK (tax_percent >= 0 AND tax_percent <= 100),
  tax_amount        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  -- Line total after discount and tax, the figure the invoice header sums.
  line_total        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (line_total >= 0),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT purchase_invoice_items_line_key UNIQUE (purchase_invoice_id, line_no),
  -- Received plus damaged plus rejected can never exceed what was ordered.
  -- This is the constraint that makes "received 80 of 100 ordered" safe: the
  -- database refuses any receipt that would invent stock.
  CONSTRAINT purchase_invoice_items_receipt_check CHECK (
    quantity_received + quantity_damaged + quantity_rejected <= quantity_ordered
  )
);
CREATE INDEX IF NOT EXISTS purchase_invoice_items_invoice_idx
  ON purchase_invoice_items (purchase_invoice_id);
CREATE INDEX IF NOT EXISTS purchase_invoice_items_product_idx
  ON purchase_invoice_items (product_id);

-- Supplier payments, kept separate from stock movements. An invoice can be
-- paid in instalments, and paying it must never move stock.
CREATE TABLE IF NOT EXISTS purchase_invoice_payments (
  id                BIGSERIAL PRIMARY KEY,
  uuid              UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  purchase_invoice_id BIGINT NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  method            TEXT NOT NULL DEFAULT 'BANK'
    CHECK (method IN ('CASH', 'BANK', 'UPI', 'CARD', 'CHEQUE', 'CREDIT_NOTE')),
  reference         TEXT,
  notes             TEXT,
  -- running total after this payment, so a ledger row audits itself.
  balance_after     NUMERIC(14,2) NOT NULL CHECK (balance_after >= 0),
  created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_invoice_payments_invoice_idx
  ON purchase_invoice_payments (purchase_invoice_id, paid_at DESC);

-- ── Goods receipts ─────────────────────────────────────────────────────────

-- A receipt records what physically arrived for one invoice. Separate from the
-- invoice because a single invoice can be received across several deliveries.
CREATE TABLE IF NOT EXISTS stock_receipts (
  id                BIGSERIAL PRIMARY KEY,
  uuid              UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  receipt_number    TEXT NOT NULL UNIQUE,
  purchase_invoice_id BIGINT NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  warehouse_id      BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status            TEXT NOT NULL DEFAULT 'RECORDED'
    CHECK (status IN ('RECORDED', 'POSTED', 'CANCELLED')),
  notes             TEXT,
  -- Damaged and missing quantities are recorded, never quietly added to
  -- available stock. Only accepted quantity is ever sellable.
  total_accepted    NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (total_accepted >= 0),
  total_damaged     NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (total_damaged >= 0),
  total_missing     NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (total_missing >= 0),
  created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_receipts_invoice_idx
  ON stock_receipts (purchase_invoice_id);
CREATE INDEX IF NOT EXISTS stock_receipts_date_idx
  ON stock_receipts (received_at DESC);

CREATE TABLE IF NOT EXISTS stock_receipt_items (
  id                BIGSERIAL PRIMARY KEY,
  uuid              UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  stock_receipt_id  BIGINT NOT NULL REFERENCES stock_receipts(id) ON DELETE CASCADE,
  purchase_invoice_item_id BIGINT NOT NULL
    REFERENCES purchase_invoice_items(id) ON DELETE CASCADE,
  quantity_accepted NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_accepted >= 0),
  quantity_damaged  NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_damaged >= 0),
  quantity_missing  NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_missing >= 0),
  unit_cost         NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  damage_reason     TEXT,
  evidence_path     TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_receipt_items_receipt_idx
  ON stock_receipt_items (stock_receipt_id);

-- ── The stock ledger ───────────────────────────────────────────────────────

-- One row per stock movement, for every location. This is the authoritative
-- audit trail: stock is never changed without one, and previous/new stock are
-- recorded on the row so a drift can be proven after the fact.
--
-- Deliberately a NEW table rather than a widening of
-- branch_inventory_transactions: that table is folded-lowercase, is documented
-- in sql/inventory.md, and is written by working transfer code. Rewriting it
-- would risk existing behaviour for no gain.
CREATE TABLE IF NOT EXISTS stock_ledger (
  id              BIGSERIAL PRIMARY KEY,
  uuid            UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  warehouse_id    BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  branch_id       BIGINT REFERENCES branches(id) ON DELETE RESTRICT,
  product_id      BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_uuid    TEXT,
  -- Signed: negative leaves the location, positive arrives. One convention
  -- means a movement's direction is never ambiguous.
  quantity        NUMERIC(14,3) NOT NULL CHECK (quantity <> 0),
  unit_cost       NUMERIC(14,4),
  -- Stock at this location before and after, for the same reason the ledger
  -- rows in the wallet carry balance_after.
  previous_stock  NUMERIC(14,3) NOT NULL,
  new_stock       NUMERIC(14,3) NOT NULL CHECK (new_stock >= 0),
  transaction_type TEXT NOT NULL
    CHECK (transaction_type IN (
      'PURCHASE_RECEIPT', 'PURCHASE_RETURN', 'SALE',
      'SALES_RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'TRANSFER_DISCREPANCY',
      'DAMAGE', 'ADJUSTMENT'
    )),
  reference_type  TEXT
    CHECK (reference_type IS NULL OR reference_type IN (
      'PURCHASE_INVOICE', 'STOCK_RECEIPT', 'STOCK_TRANSFER',
      'SALES_INVOICE', 'SALES_RETURN', 'ADJUSTMENT'
    )),
  reference_id    BIGINT,
  note            TEXT,
  performed_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- new_stock can never be negative. The database is the overdraft guard, not
  -- the service that happens to check first.
  CONSTRAINT stock_ledger_nonneg_check CHECK (new_stock >= 0),
  -- The warehouse/branch pairing is NOT re-checked here. Postgres forbids a
  -- subquery inside CHECK, and the rule already lives where it can be enforced
  -- properly: warehouses_branch_shape_check guarantees a CENTRAL warehouse has
  -- no branch and a BRANCH one always does. This table carries both ids so a
  -- reader never has to guess which kind of location a row refers to; the
  -- service that writes it sets branch_id only for branch locations.
  CONSTRAINT stock_ledger_branch_needs_warehouse_check
    CHECK (branch_id IS NULL OR warehouse_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS stock_ledger_product_idx
  ON stock_ledger (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_ledger_location_idx
  ON stock_ledger (warehouse_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_ledger_reference_idx
  ON stock_ledger (reference_type, reference_id);
CREATE INDEX IF NOT EXISTS stock_ledger_type_idx
  ON stock_ledger (transaction_type, created_at DESC);

-- ── Sales invoices ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_invoices (
  id                BIGSERIAL PRIMARY KEY,
  uuid              UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  invoice_number    TEXT NOT NULL UNIQUE,
  -- One sales invoice per order, enforced by the database. This is the
  -- duplicate-invoice guard the spec asks for: retries, double-clicks and
  -- webhook replays all collide here instead of producing a second document.
  order_id          BIGINT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  customer_id       BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  invoice_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date          DATE,
  -- Snapshotted, not joined: the address a customer was billed to must not
  -- change because they later edited their address book.
  customer_name     TEXT NOT NULL DEFAULT '',
  customer_email    TEXT,
  customer_mobile   TEXT,
  billing_address   TEXT,
  shipping_address  TEXT,
  branch_id         BIGINT REFERENCES branches(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'ISSUED'
    CHECK (status IN ('DRAFT', 'ISSUED', 'PAID', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')),
  payment_status    TEXT NOT NULL DEFAULT 'UNPAID'
    CHECK (payment_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED')),
  subtotal          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  shipping_total    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (shipping_total >= 0),
  total_amount      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  currency          TEXT NOT NULL DEFAULT 'INR',
  payment_method    TEXT,
  tax_rate_id       BIGINT REFERENCES tax_rates(id) ON DELETE SET NULL,
  notes             TEXT,
  pdf_path          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_invoices_customer_idx
  ON sales_invoices (customer_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS sales_invoices_branch_idx
  ON sales_invoices (branch_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS sales_invoices_date_idx
  ON sales_invoices (invoice_date DESC);
CREATE INDEX IF NOT EXISTS sales_invoices_status_idx
  ON sales_invoices (status);

CREATE TABLE IF NOT EXISTS sales_invoice_items (
  id                BIGSERIAL PRIMARY KEY,
  uuid              UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  sales_invoice_id  BIGINT NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  order_item_id     BIGINT REFERENCES order_items(id) ON DELETE SET NULL,
  line_no           INTEGER NOT NULL CHECK (line_no > 0),
  product_id        BIGINT REFERENCES products(id) ON DELETE SET NULL,
  variant           TEXT,
  sku               TEXT NOT NULL DEFAULT '',
  name              TEXT NOT NULL,
  quantity          NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price        NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (line_total >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sales_invoice_items_line_key UNIQUE (sales_invoice_id, line_no)
);
CREATE INDEX IF NOT EXISTS sales_invoice_items_invoice_idx
  ON sales_invoice_items (sales_invoice_id);

-- ── Returns and credit notes ───────────────────────────────────────────────

-- One table for both directions, discriminated by direction, because a
-- purchase return and a sales return are the same document shape and splitting
-- them would duplicate every column and every constraint.
CREATE TABLE IF NOT EXISTS returns (
  id                BIGSERIAL PRIMARY KEY,
  uuid              UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  return_number     TEXT NOT NULL UNIQUE,
  direction         TEXT NOT NULL CHECK (direction IN ('PURCHASE', 'SALE')),
  -- The original document. Exactly one of the two, matching direction, so a
  -- sales return can never be raised against a purchase invoice.
  purchase_invoice_id BIGINT REFERENCES purchase_invoices(id) ON DELETE RESTRICT,
  sales_invoice_id    BIGINT REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  warehouse_id      BIGINT REFERENCES warehouses(id) ON DELETE RESTRICT,
  branch_id         BIGINT REFERENCES branches(id) ON DELETE RESTRICT,
  return_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  status            TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'APPROVED', 'COMPLETED', 'CANCELLED')),
  -- Sales returns need an inspection verdict. Returned goods are never added
  -- to sellable stock on arrival: they are held until inspected.
  inspection_status TEXT
    CHECK (inspection_status IS NULL OR
           inspection_status IN ('PENDING', 'SELLABLE', 'DAMAGED', 'REJECTED')),
  total_amount      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  refund_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  credit_note_id    BIGINT,
  reason            TEXT NOT NULL DEFAULT '',
  notes             TEXT,
  created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The FK the branch owns, checked against direction. This is what stops a
  -- sales return referencing a purchase invoice.
  CONSTRAINT returns_source_check CHECK (
    (direction = 'PURCHASE' AND purchase_invoice_id IS NOT NULL AND sales_invoice_id IS NULL) OR
    (direction = 'SALE'    AND sales_invoice_id    IS NOT NULL AND purchase_invoice_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS returns_direction_idx ON returns (direction, return_date DESC);
CREATE INDEX IF NOT EXISTS returns_purchase_invoice_idx ON returns (purchase_invoice_id);
CREATE INDEX IF NOT EXISTS returns_sales_invoice_idx ON returns (sales_invoice_id);

CREATE TABLE IF NOT EXISTS return_items (
  id                BIGSERIAL PRIMARY KEY,
  uuid              UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  return_id         BIGINT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  line_no           INTEGER NOT NULL CHECK (line_no > 0),
  -- Which line of the original document is being returned.
  purchase_invoice_item_id BIGINT REFERENCES purchase_invoice_items(id) ON DELETE RESTRICT,
  sales_invoice_item_id    BIGINT REFERENCES sales_invoice_items(id) ON DELETE RESTRICT,
  product_id        BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  sku               TEXT NOT NULL DEFAULT '',
  name              TEXT NOT NULL DEFAULT '',
  quantity          NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  amount            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  -- Sales returns only, and only after inspection. Until then the quantity
  -- is not sellable stock.
  inspection_result TEXT
    CHECK (inspection_result IS NULL OR
           inspection_result IN ('PENDING', 'SELLABLE', 'DAMAGED', 'REJECTED')),
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT return_items_line_key UNIQUE (return_id, line_no)
);
CREATE INDEX IF NOT EXISTS return_items_return_idx ON return_items (return_id);

CREATE TABLE IF NOT EXISTS credit_notes (
  id                BIGSERIAL PRIMARY KEY,
  uuid              UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  credit_note_number TEXT NOT NULL UNIQUE,
  -- A credit note is either raised against a purchase (we owe the supplier a
  -- refund) or a sale (we owe the customer one).
  direction         TEXT NOT NULL CHECK (direction IN ('SUPPLIER', 'CUSTOMER')),
  return_id         BIGINT REFERENCES returns(id) ON DELETE SET NULL,
  purchase_invoice_id BIGINT REFERENCES purchase_invoices(id) ON DELETE SET NULL,
  sales_invoice_id  BIGINT REFERENCES sales_invoices(id) ON DELETE SET NULL,
  issue_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  amount            NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  applied_amount    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (applied_amount >= 0),
  status            TEXT NOT NULL DEFAULT 'ISSUED'
    CHECK (status IN ('ISSUED', 'PARTIALLY_APPLIED', 'APPLIED', 'CANCELLED')),
  reason            TEXT,
  notes             TEXT,
  created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A credit note can never be over-applied, which is how a refund ends up
  -- larger than the sale it corrects.
  CONSTRAINT credit_notes_applied_check CHECK (applied_amount <= amount)
);
CREATE INDEX IF NOT EXISTS credit_notes_direction_idx ON credit_notes (direction, issue_date DESC);

-- Customer refunds. Separate from purchase_invoice_payments because a refund to
-- a customer is not money paid to a supplier, and the two must not be netted.
CREATE TABLE IF NOT EXISTS sales_refunds (
  id                BIGSERIAL PRIMARY KEY,
  uuid              UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  sales_invoice_id  BIGINT NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  refunded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  method            TEXT NOT NULL DEFAULT 'BANK'
    CHECK (method IN ('CASH', 'BANK', 'UPI', 'CARD', 'CHEQUE', 'CREDIT_NOTE',
                      'STORE_CREDIT')),
  reference         TEXT,
  reason            TEXT,
  created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_refunds_invoice_idx
  ON sales_refunds (sales_invoice_id, refunded_at DESC);

-- ── Audit ──────────────────────────────────────────────────────────────────

-- Who changed which money or stock figure, and when. Separate from
-- stock_ledger, which records quantities; this records the decision.
CREATE TABLE IF NOT EXISTS audit_logs (
  id              BIGSERIAL PRIMARY KEY,
  uuid            UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  entity_type     TEXT NOT NULL,
  entity_id       BIGINT,
  action          TEXT NOT NULL
    CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'CANCEL', 'RECEIVE',
                      'PAY', 'REFUND', 'APPROVE', 'DISPATCH', 'REJECT')),
  -- Field-level diff. Only what changed, so the row stays small and a
  -- password hash never ends up in an audit record.
  changes         JSONB NOT NULL DEFAULT '{}',
  performed_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ip_address      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
  ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (performed_by, created_at DESC);

INSERT INTO tax_rates (code, name, rate, is_inclusive)
VALUES ('GST_0',  'GST 0%',  0,  FALSE),
       ('GST_5',  'GST 5%',  5,  FALSE),
       ('GST_12', 'GST 12%', 12, FALSE),
       ('GST_18', 'GST 18%', 18, FALSE),
       ('GST_28', 'GST 28%', 28, FALSE)
ON CONFLICT (code) DO NOTHING;
