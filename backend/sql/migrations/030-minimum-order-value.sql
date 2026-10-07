-- Minimum Order Value, configurable by an admin.
--
-- The existing `settings` table is a single-row theme store (theme_color,
-- dark_mode) with no key/value shape, so it cannot hold an order rule without
-- being reshaped. This adds a proper key/value table instead, which the spec
-- explicitly permits and which also leaves room for the scoped variants
-- (branch, customer type, delivery area) later without another migration.
--
-- SAFETY: additive only. Nothing existing is read, rewritten or removed, and the
-- rule ships DISABLED with amount 0 so no current shopper is affected until an
-- admin turns it on. Changing the seed below would be the only way to alter
-- behaviour for existing customers, and it is deliberately inert.
--
-- Change history lives in min_order_value_history rather than reusing
-- audit_logs: this is a self-contained, queryable trail of one setting, and the
-- rows are appended to, never updated or deleted.

CREATE TABLE IF NOT EXISTS store_settings (
  id          BIGSERIAL PRIMARY KEY,
  uuid        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  -- Dotted names, matching the permission slugs used elsewhere in the app.
  -- 'order.min_order_value.amount' and '.order.min_order_value.enabled'.
  key         TEXT NOT NULL UNIQUE,
  value       TEXT,
  -- Optional scope, present but unused today so per-branch or per-customer-type
  -- rules can be added without another schema change.
  scope_type  TEXT NOT NULL DEFAULT 'GLOBAL' CHECK (scope_type IN ('GLOBAL', 'BRANCH', 'CUSTOMER_TYPE', 'DELIVERY_AREA')),
  scope_id    BIGINT,
  is_public   BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  updated_by  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One value per scope: a global rule and a branch rule cannot collide.
  CONSTRAINT store_settings_scope_key UNIQUE (scope_type, scope_id, key)
);

-- Who changed the minimum, what it was, and what it became.
CREATE TABLE IF NOT EXISTS min_order_value_history (
  id          BIGSERIAL PRIMARY KEY,
  uuid        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  previous_amount NUMERIC(12,2),
  new_amount     NUMERIC(12,2),
  previous_enabled BOOLEAN,
  new_enabled     BOOLEAN,
  changed_by  BIGINT,
  -- Free text, so a change is still meaningful if the user row is later removed.
  changed_by_email TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS min_order_value_history_created_idx
  ON min_order_value_history (created_at DESC);

-- Seeded OFF with 0, so until an admin enables it every existing cart and order
-- behaves exactly as before. ON CONFLICT DO NOTHING means re-running this file
-- can never reset a value an admin has since set.
INSERT INTO store_settings (key, value, is_public, description)
VALUES
  ('order.min_order_value.amount',  '0', TRUE,
   'Minimum eligible order subtotal required before checkout. Ignored when disabled.'),
  ('order.min_order_value.enabled', 'false', TRUE,
   'Whether the minimum order value is enforced at checkout.')
ON CONFLICT (key) DO NOTHING;