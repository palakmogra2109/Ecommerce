-- Earth धान्य schema
-- Idempotent: safe to run on a fresh or existing database.
--
-- This is the BOOTSTRAP file: it is the DDL for an EMPTY database. A fresh
-- install is expected to come out identical to the live one, so every column
-- below is spelled and ordered the way the running database has it. The live
-- shape is recorded in sql/inventory.md (`npm run gen:inventory`), and
-- `node scripts/verify-phase1.mjs` fails if this file and the live schema drift
-- apart in either direction.
--
-- Two spellings are in play, both of them real:
--
--   * The branch tables were created with unquoted camelCase column names, which
--     PostgreSQL folded to lowercase. The live columns are `addressline1`,
--     `stockquantity`, `createdat`, `previousstocksource`, ... so that is how
--     they are written here - folded, not camelCase. Do NOT "fix" them to
--     snake_case: the models in lib/models/ alias these folded names back to
--     camelCase on the way out precisely because the database folded them, and
--     the indexes and foreign keys below reference the folded spelling.
--   * `orders` and `users` are snake_case (`order_number`, `created_at`,
--     `payment_method`). `orders.branchid` is the one folded name in an
--     otherwise snake_case table, again because of an unquoted camelCase ALTER.
--
-- Where the live table has a UNIQUE INDEX rather than a UNIQUE CONSTRAINT the
-- index is created explicitly below, so a fresh install matches constraint for
-- constraint. Uniqueness is enforced either way; nothing in the codebase uses
-- `ON CONFLICT ON CONSTRAINT`, only `ON CONFLICT (columns)`, which resolves
-- against a unique index just as well.

-- gen_random_uuid() needs the pgcrypto extension on PostgreSQL 12.
-- On PostgreSQL 13+ it is built in, so this is a no-op there.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================
-- users
-- =============================================================
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(255) NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status      TEXT NOT NULL DEFAULT 'ACTIVE',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  mobile      TEXT,
  avatar      TEXT,
  uuid        UUID NOT NULL DEFAULT gen_random_uuid(),
  parent_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  countrycode TEXT
);

-- Backfill columns on existing databases
ALTER TABLE users ADD COLUMN IF NOT EXISTS uuid       UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE users ADD COLUMN IF NOT EXISTS status    TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_id  BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS countrycode TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_uuid_key ON users(uuid);

-- One-time passcodes for storefront mobile login. Codes are short-lived and
-- stored hashed; verification consumes the row. See
-- sql/migrations/003-otp-codes.sql on existing databases.
CREATE TABLE IF NOT EXISTS otp_codes (
  id           BIGSERIAL PRIMARY KEY,
  uuid         UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  identifier   TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  purpose      TEXT NOT NULL DEFAULT 'login',
  attempts     INTEGER NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_codes_identifier_idx ON otp_codes(identifier);

-- `users.status` carries no CHECK constraint in the live database - every other
-- status column here does - so none is declared above. Adding one would make a
-- fresh install reject writes the running system accepts.

-- =============================================================
-- roles
-- =============================================================
CREATE TABLE IF NOT EXISTS roles (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  uuid        UUID NOT NULL DEFAULT gen_random_uuid()
);

ALTER TABLE roles ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS roles_uuid_key ON roles(uuid);

-- =============================================================
-- permissions
-- =============================================================
CREATE TABLE IF NOT EXISTS permissions (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  module      TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  uuid        UUID NOT NULL DEFAULT gen_random_uuid()
);

ALTER TABLE permissions ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS permissions_uuid_key ON permissions(uuid);

-- =============================================================
-- modules
-- Feature areas of the application (e.g. users, products, orders).
-- =============================================================
CREATE TABLE IF NOT EXISTS modules (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================
-- module_has_roles
-- Assigns roles to a module (which roles a module can use).
-- =============================================================
CREATE TABLE IF NOT EXISTS module_has_roles (
  module_id   BIGINT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  role_id     BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (module_id, role_id)
);

-- =============================================================
-- user_has_roles
-- Assigns roles to users.
-- =============================================================
CREATE TABLE IF NOT EXISTS user_has_roles (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

-- =============================================================
-- role_has_permissions
-- Which permissions a role grants.
-- =============================================================
CREATE TABLE IF NOT EXISTS role_has_permissions (
  role_id       BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

-- =============================================================
-- user_has_permissions
-- Optional per-user permissions on top of role permissions.
-- =============================================================
CREATE TABLE IF NOT EXISTS user_has_permissions (
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_id)
);

-- =============================================================
-- settings
-- Single global settings row (id is fixed to 1).
-- theme_color drives the brand accent across the admin panel
-- and the {{themePrimary}} placeholder in email templates.
-- dark_mode switches the admin panel to dark mode.
-- =============================================================
CREATE TABLE IF NOT EXISTS settings (
  id          BIGINT PRIMARY KEY,
  theme_color TEXT NOT NULL DEFAULT '#3b82f6',
  dark_mode   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (id, theme_color, dark_mode)
VALUES (1, '#3b82f6', FALSE)
ON CONFLICT (id) DO NOTHING;

-- =============================================================
-- email_templates
-- Editable email content. Placeholders like {{userName}} in the
-- subject/body are replaced with dynamic values at send time.
-- =============================================================
CREATE TABLE IF NOT EXISTS email_templates (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  subject     TEXT NOT NULL,
  body_html   TEXT NOT NULL,
  body_text   TEXT NOT NULL,
  variables   JSONB NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  uuid        UUID NOT NULL DEFAULT gen_random_uuid()
);

ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS email_templates_uuid_key ON email_templates(uuid);

-- =============================================================
-- categories
-- Self-referencing tree with an image, status and SEO fields.
-- =============================================================
CREATE TABLE IF NOT EXISTS categories (
  id               BIGSERIAL PRIMARY KEY,
  uuid             UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  description      TEXT NOT NULL DEFAULT '',
  image            TEXT,
  parent_id        BIGINT REFERENCES categories(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'INACTIVE')),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  meta_title       TEXT NOT NULL DEFAULT '',
  meta_description TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE categories ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE categories ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS image TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id BIGINT REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS meta_title TEXT NOT NULL DEFAULT '';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS meta_description TEXT NOT NULL DEFAULT '';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS categories_uuid_key ON categories(uuid);

-- =============================================================
-- brands
-- =============================================================
CREATE TABLE IF NOT EXISTS brands (
  id          BIGSERIAL PRIMARY KEY,
  uuid        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  logo        TEXT,
  status      TEXT NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE brands ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE brands ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE brands ADD COLUMN IF NOT EXISTS logo TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE brands ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS brands_uuid_key ON brands(uuid);

-- =============================================================
-- attributes
-- Dynamic product attributes (colour, size, material, ...).
-- Products reference these in their `attributes` JSONB column.
-- =============================================================
CREATE TABLE IF NOT EXISTS attributes (
  id          BIGSERIAL PRIMARY KEY,
  uuid        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE attributes ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE attributes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE attributes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS attributes_uuid_key ON attributes(uuid);

-- =============================================================
-- products
-- Attributes (array of {attribute_uuid, name, value}), images
-- (array of URLs) and variants (array of {name, sku, price, stock,
-- attributes}) are stored as JSONB so the catalogue stays flexible.
-- =============================================================
CREATE TABLE IF NOT EXISTS products (
  id                  BIGSERIAL PRIMARY KEY,
  uuid                UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  sku                 TEXT NOT NULL,
  short_description   TEXT NOT NULL DEFAULT '',
  description         TEXT NOT NULL DEFAULT '',
  price               NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_price      NUMERIC(12,2),
  stock               INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  brand_id            BIGINT REFERENCES brands(id) ON DELETE SET NULL,
  category_id         BIGINT REFERENCES categories(id) ON DELETE SET NULL,
  images              JSONB NOT NULL DEFAULT '[]',
  attributes          JSONB NOT NULL DEFAULT '[]',
  variants            JSONB NOT NULL DEFAULT '[]',
  meta_title          TEXT NOT NULL DEFAULT '',
  meta_description    TEXT NOT NULL DEFAULT '',
  meta_keywords       TEXT NOT NULL DEFAULT '',
  featured            BOOLEAN NOT NULL DEFAULT FALSE,
  status              TEXT NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  inventory_mode      TEXT NOT NULL DEFAULT 'SINGLE',
  pricing_attribute_uuid UUID,
  expiry_date         DATE
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE products ADD COLUMN IF NOT EXISTS short_description TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS price NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_price NUMERIC(12,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 5;
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand_id BIGINT REFERENCES brands(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]';
ALTER TABLE products ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '[]';
ALTER TABLE products ADD COLUMN IF NOT EXISTS variants JSONB NOT NULL DEFAULT '[]';
ALTER TABLE products ADD COLUMN IF NOT EXISTS meta_title TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS meta_description TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS meta_keywords TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE products ADD COLUMN IF NOT EXISTS inventory_mode TEXT NOT NULL DEFAULT 'SINGLE';
ALTER TABLE products ADD COLUMN IF NOT EXISTS pricing_attribute_uuid UUID;
ALTER TABLE products ADD COLUMN IF NOT EXISTS expiry_date DATE;
CREATE UNIQUE INDEX IF NOT EXISTS products_uuid_key ON products(uuid);
CREATE INDEX IF NOT EXISTS products_expiry_date_idx ON products(expiry_date);
CREATE INDEX IF NOT EXISTS products_category_status_idx ON products(category_id, status);

-- =============================================================
-- customers
-- Billing/shipping address is kept as JSONB so it can carry any
-- set of fields without schema churn.
-- =============================================================
CREATE TABLE IF NOT EXISTS customers (
  id             BIGSERIAL PRIMARY KEY,
  uuid           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  mobile         TEXT,
  address        JSONB NOT NULL DEFAULT '{}',
  addresses      JSONB NOT NULL DEFAULT '[]',
  status         TEXT NOT NULL DEFAULT 'ACTIVE'
                 CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  order_count    INTEGER NOT NULL DEFAULT 0,
  total_spent    NUMERIC(12,2) NOT NULL DEFAULT 0,
  first_order_at TIMESTAMPTZ,
  last_order_at  TIMESTAMPTZ
);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE customers ADD COLUMN IF NOT EXISTS mobile TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address JSONB NOT NULL DEFAULT '{}';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS addresses JSONB NOT NULL DEFAULT '[]';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE customers ADD COLUMN IF NOT EXISTS order_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_spent NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS first_order_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_order_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS customers_uuid_key ON customers(uuid);
CREATE INDEX IF NOT EXISTS customers_created_at_idx ON customers(created_at);

-- =============================================================
-- coupons
-- Percentage or fixed discounts with optional validity window and
-- usage limits. used_count reflects redemptions so far.
-- =============================================================
CREATE TABLE IF NOT EXISTS coupons (
  id                  BIGSERIAL PRIMARY KEY,
  uuid                UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  code                TEXT NOT NULL UNIQUE,
  type                TEXT NOT NULL DEFAULT 'PERCENTAGE'
                      CHECK (type IN ('PERCENTAGE', 'FIXED')),
  value               NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_order_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_discount_amount NUMERIC(12,2),
  starts_at           TIMESTAMPTZ,
  ends_at             TIMESTAMPTZ,
  usage_limit         INTEGER,
  per_customer_limit  INTEGER NOT NULL DEFAULT 1,
  used_count          INTEGER NOT NULL DEFAULT 0,
  description         TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Gift card denomination catalogue: the products a shopper can buy. Defined
-- before gift_cards because gift_cards.denomination_uuid references it.
CREATE TABLE IF NOT EXISTS gift_denominations (
  id             BIGSERIAL PRIMARY KEY,
  uuid           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  label          TEXT NOT NULL,
  face_value     NUMERIC(12,2) NOT NULL CHECK (face_value > 0),
  selling_price  NUMERIC(12,2) CHECK (selling_price > 0),
  valid_for_days INTEGER CHECK (valid_for_days > 0),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A price above the face value would silently overcharge.
  CONSTRAINT gift_denominations_price_check CHECK (selling_price IS NULL OR selling_price <= face_value)
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_denominations_uuid_key ON gift_denominations(uuid);
CREATE INDEX IF NOT EXISTS gift_denominations_active_idx ON gift_denominations(is_active, sort_order);

-- Gift cards: admin-issued stored value redeemed at checkout. Balances live
-- on gift_cards; every movement is audited in gift_card_transactions.
CREATE TABLE IF NOT EXISTS gift_cards (
  id               BIGSERIAL PRIMARY KEY,
  uuid             UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  -- Legacy plaintext column. New cards store NULL and are matched by
  -- code_hash instead; rows issued before hashing keep their code.
  code             TEXT,
  code_hash        TEXT,
  code_last4       TEXT,
  initial_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance          NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'INR',
  source           TEXT NOT NULL DEFAULT 'FIXED',
  customer_id      BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  recipient_email  TEXT,
  image_url      TEXT,
  label          TEXT NOT NULL DEFAULT 'Gift Card',
  status           TEXT NOT NULL DEFAULT 'DRAFT'
                   -- Widened by 017, which adds ARCHIVED alongside every value
                   -- accepted before it. Widening, never narrowing: the
                   -- migration retires the issued cards to ARCHIVED without
                   -- deleting them, so a vocabulary that rejected the values
                   -- those rows already hold would make this table un-updatable
                   -- rather than cleaner. The issued-only states stay for the
                   -- same reason — the rows carrying them are still here.
                   CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'REDEEMED', 'ARCHIVED')),
  usage_limit      INTEGER,
  min_order_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_redemption_amount NUMERIC(12,2),
  selling_price  NUMERIC(12,2),
  denomination_uuid UUID REFERENCES gift_denominations(uuid) ON DELETE SET NULL,
  applicable_branches  JSONB NOT NULL DEFAULT '[]',
  applicable_brands  JSONB NOT NULL DEFAULT '[]',
  applicable_products  JSONB NOT NULL DEFAULT '[]',
  applicable_categories JSONB NOT NULL DEFAULT '[]',
  activated_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_uuid_key ON gift_cards(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_code_key ON gift_cards(code);
CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_code_hash_key ON gift_cards(code_hash);
CREATE INDEX IF NOT EXISTS gift_cards_recipient_idx ON gift_cards(recipient_email);
CREATE INDEX IF NOT EXISTS gift_cards_customer_idx ON gift_cards(customer_id);
CREATE INDEX IF NOT EXISTS gift_cards_status_idx ON gift_cards(status);

-- gift_cards is the TEMPLATE: the admin-managed thing a shopper buys, rather
-- than the issued card itself. The issued-card columns above are still correct
-- for the cards already issued and stay until the data migration has moved
-- those rows into gift_card_codes, which keeps a rollback possible.
--
-- Added by ALTER rather than declared inline, for the same reason the orders
-- branch columns are added lower down: the table is already created above and
-- these belong to a later migration, and IF NOT EXISTS keeps this file
-- re-runnable. Mirrors 016-gift-card-template-columns.sql.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
-- The sell gate, separate from `status`, so a card can be paused without losing
-- the DRAFT/ACTIVE/ARCHIVED history that `status` records.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
-- Copied onto the issued code at issue time: a template's validity changing
-- later must not silently rewrite the expiry of a gift already in someone's
-- hands. NULL means it never expires.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS validity_days INTEGER;
-- The window the template may be *sold* in, as opposed to how long an issued
-- code lasts. Half-open windows stay legal.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;
-- NULL means no cap, which is why these are nullable: "unlimited" and "nothing
-- allowed" must not read the same.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS per_order_limit NUMERIC(12,2);
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS max_quantity_per_order INTEGER;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS face_value NUMERIC(12,2);

DO $$
BEGIN
  -- 0 or negative days would issue codes that are already expired on arrival.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'gift_cards'::regclass
       AND conname = 'gift_cards_validity_days_check'
  ) THEN
    ALTER TABLE gift_cards
      ADD CONSTRAINT gift_cards_validity_days_check CHECK (validity_days > 0);
  END IF;
  -- A cap of zero cards per order is a sellable card nobody can buy.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'gift_cards'::regclass
       AND conname = 'gift_cards_max_quantity_per_order_check'
  ) THEN
    ALTER TABLE gift_cards
      ADD CONSTRAINT gift_cards_max_quantity_per_order_check CHECK (max_quantity_per_order > 0);
  END IF;
  -- A window that ends before it starts can never be sold.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'gift_cards'::regclass
       AND conname = 'gift_cards_sell_window_check'
  ) THEN
    ALTER TABLE gift_cards
      ADD CONSTRAINT gift_cards_sell_window_check
      CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at);
  END IF;
END $$;

-- Storefront listings filter on the sell gate; the sweep that finds templates
-- whose window has closed reads ends_at directly.
CREATE INDEX IF NOT EXISTS gift_cards_is_active_idx ON gift_cards(is_active);
CREATE INDEX IF NOT EXISTS gift_cards_ends_at_idx ON gift_cards(ends_at);

-- The template status constraint widens ('DRAFT' / 'ACTIVE' / 'ARCHIVED' plus
-- the legacy issued states) — see the CHECK on the column above.
--
-- 016 deliberately did NOT touch the status CHECK, and deferred it to the data
-- migration: narrowing it to the three template states would have rejected the
-- issued cards that are still stored as rows, since CANCELLED and REDEEMED
-- describe cards that exist rather than templates. 017 is that data migration,
-- and it widens the vocabulary rather than narrowing it, because the rows it
-- retires are the very rows the constraint has to keep accepting.
--
-- Only the structural half of 017 is mirrored here. The CHECK is the shape; the
-- INSERT and UPDATE that move live rows from gift_cards into gift_card_codes are
-- not, because a fresh install has no legacy rows to move, and a migration whose
-- data statements are also in the bootstrap would run them on an empty table and
-- look like it had done something.

-- gift_card_transactions is defined after orders, below, because it references
-- orders(id) and a fresh install must build in dependency order.

-- Scheduled gift card deliveries. A scheduled card is not created at purchase
-- time: only the intent is stored, and the card plus its code come into
-- existence when the send time arrives.
CREATE TABLE IF NOT EXISTS gift_card_scheduled (
  id              BIGSERIAL PRIMARY KEY,
  uuid            UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency        TEXT NOT NULL DEFAULT 'INR',
  recipient_email TEXT NOT NULL,
  recipient_name  TEXT,
  gift_message    TEXT,
  scheduled_for   TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'CANCELLED')),
  card_uuid       UUID,
  selling_price   NUMERIC(12,2),
  denomination_uuid UUID REFERENCES gift_denominations(uuid) ON DELETE SET NULL,
  valid_for_days  INTEGER CHECK (valid_for_days > 0),
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_scheduled_uuid_key ON gift_card_scheduled(uuid);
CREATE INDEX IF NOT EXISTS gift_card_scheduled_due_idx
  ON gift_card_scheduled(scheduled_for) WHERE status = 'PENDING';

-- Gift card reservations: value held on a card while the order's payment is in
-- flight, so two shoppers cannot both spend the same balance. Kept forever so
-- the trail survives a refund.
CREATE TABLE IF NOT EXISTS gift_card_reservations (
  id             BIGSERIAL PRIMARY KEY,
  uuid           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  gift_card_id   BIGINT NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  order_uuid     UUID,
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status         TEXT NOT NULL DEFAULT 'RESERVED'
                 CHECK (status IN ('RESERVED', 'CONSUMED', 'RELEASED', 'EXPIRED')),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '15 minutes'),
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_reservations_uuid_key ON gift_card_reservations(uuid);
CREATE INDEX IF NOT EXISTS gift_card_reservations_card_idx ON gift_card_reservations(gift_card_id, status);
CREATE INDEX IF NOT EXISTS gift_card_reservations_order_idx ON gift_card_reservations(order_uuid);
CREATE INDEX IF NOT EXISTS gift_card_reservations_expiry_idx ON gift_card_reservations(status, expires_at);
-- One live reservation per order, so a checkout retry reuses the hold.
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_reservations_active_order_key
  ON gift_card_reservations(order_uuid)
  WHERE status = 'RESERVED' AND order_uuid IS NOT NULL;

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS max_discount_amount NUMERIC(12,2);
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS usage_limit INTEGER;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS per_customer_limit INTEGER NOT NULL DEFAULT 1;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS used_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS coupons_uuid_key ON coupons(uuid);

-- =============================================================
-- orders + order_items
-- Orders snapshot the customer and product data at purchase time so
-- history stays stable even if the customer or product changes.
-- =============================================================
CREATE TABLE IF NOT EXISTS orders (
  id             BIGSERIAL PRIMARY KEY,
  uuid           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  order_number   TEXT NOT NULL UNIQUE,
  customer_id    BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  customer_name  TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  customer_mobile TEXT,
  shipping_address JSONB NOT NULL DEFAULT '{}',
  subtotal       NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total          NUMERIC(12,2) NOT NULL DEFAULT 0,
  coupon_id      BIGINT REFERENCES coupons(id) ON DELETE SET NULL,
  coupon_code    TEXT,
  payment_method TEXT NOT NULL DEFAULT 'cod'
                  CHECK (payment_method IN ('card', 'cod', 'upi', 'netbanking', 'wallet')),
  payment_status TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (payment_status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED')),
  status         TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','CONFIRMED','PROCESSING','PACKED','SHIPPED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED','REFUNDED')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_mobile TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address JSONB NOT NULL DEFAULT '{}';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id BIGINT REFERENCES coupons(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_card_id BIGINT REFERENCES gift_cards(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cod';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS orders_uuid_key ON orders(uuid);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at);
CREATE INDEX IF NOT EXISTS orders_customer_id_created_at_idx ON orders(customer_id, created_at);
CREATE INDEX IF NOT EXISTS orders_status_created_at_idx ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS orders_payment_method_created_at_idx ON orders(payment_method, created_at);
CREATE INDEX IF NOT EXISTS orders_coupon_id_created_at_idx ON orders(coupon_id, created_at);

-- Every gift card movement is audited here. Defined after orders so the
-- order_id foreign reference resolves on a fresh install.
CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id              BIGSERIAL PRIMARY KEY,
  uuid            UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  gift_card_id    BIGINT NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  order_id        BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  type            TEXT NOT NULL CHECK (type IN ('ISSUE', 'PURCHASED', 'ACTIVATED', 'REDEEM', 'REFUND', 'REVERSAL', 'ADJUSTMENT', 'EXPIRED', 'CANCELLED')),
  amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_before  NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_after   NUMERIC(12,2) NOT NULL DEFAULT 0,
  performed_by    TEXT,
  reason          TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gift_card_transactions_card_idx ON gift_card_transactions(gift_card_id);
CREATE INDEX IF NOT EXISTS gift_card_transactions_order_idx ON gift_card_transactions(order_id);

-- =============================================================
-- gift card v2
-- gift_cards (above) is the template a shopper buys; everything below is what
-- happens once money has changed hands: an order for N codes, the issued codes
-- themselves, how they are delivered and spent, and the wallet they credit.
-- The legacy tables above are left alone so a rollback stays possible until the
-- data migration has moved the rows across. Mirrors 015-gift-card-v2-tables.sql.
--
-- Defined here, after orders, because gift_card_redemptions references orders.
-- =============================================================

-- A paid order for one or more codes: the seam between the catalogue and what a
-- shopper bought. Survives its code rows, so a refund never rewrites history.
CREATE TABLE IF NOT EXISTS gift_card_purchases (
  id                 BIGSERIAL PRIMARY KEY,
  uuid               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  purchaser_id       BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  template_id        BIGINT NOT NULL REFERENCES gift_cards(id) ON DELETE RESTRICT,
  quantity           INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_face_value    NUMERIC(12,2) NOT NULL CHECK (unit_face_value > 0),
  -- NULL means it was not recorded separately; 0 is a valid discounted price.
  unit_selling_price NUMERIC(12,2) CHECK (unit_selling_price IS NULL OR unit_selling_price >= 0),
  total_amount       NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
  currency           TEXT NOT NULL DEFAULT 'INR',
  -- Names a provider from the payment registry, so a refund knows which gateway
  -- to talk to.
  payment_provider   TEXT NOT NULL DEFAULT 'sandbox',
  payment_intent_id  TEXT,
  payment_reference  TEXT,
  -- Payment and fulfilment fail separately: a captured payment can still be
  -- waiting on a scheduled send.
  payment_status     TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (payment_status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED')),
  status             TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'
                      CHECK (status IN ('PENDING_PAYMENT', 'ISSUED', 'SCHEDULED', 'CANCELLED', 'REFUNDED')),
  recipient_email    TEXT,
  recipient_name     TEXT,
  gift_message       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_purchases_uuid_key ON gift_card_purchases(uuid);
CREATE INDEX IF NOT EXISTS gift_card_purchases_purchaser_idx ON gift_card_purchases(purchaser_id);
CREATE INDEX IF NOT EXISTS gift_card_purchases_status_idx ON gift_card_purchases(status);

-- An issued code: the heart of the system, matched by hash so a database dump
-- cannot be replayed at checkout. EXPIRED is deliberately not a status — it is
-- derived from expires_at at read time, so a clock tick cannot leave a stale
-- value behind.
CREATE TABLE IF NOT EXISTS gift_card_codes (
  id            BIGSERIAL PRIMARY KEY,
  uuid          UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  template_id   BIGINT NOT NULL REFERENCES gift_cards(id) ON DELETE RESTRICT,
  purchase_id   BIGINT REFERENCES gift_card_purchases(id) ON DELETE SET NULL,
  -- Checked by the index, so a race between two issuances loses one of them
  -- instead of minting a duplicate.
  code_hash     TEXT NOT NULL UNIQUE,
  code_last4    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'
                CHECK (status IN ('PENDING_PAYMENT', 'UNUSED', 'REDEEMED', 'REVOKED', 'SCHEDULED')),
  currency      TEXT NOT NULL DEFAULT 'INR',
  face_value    NUMERIC(12,2) NOT NULL CHECK (face_value > 0),
  -- What was actually credited to a wallet. Equal to face_value for a full
  -- claim; a partial claim credits less.
  claimed_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  claimed_by    BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  claimed_at    TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  revoked_reason TEXT,
  -- The admin who voided it. NULL means it lapsed on its own, or nobody recorded
  -- an actor; the reason column alone would not answer "who did this".
  revoked_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- No claim may be worth more than the card was sold for.
  CONSTRAINT gift_card_codes_claimed_value_check
    CHECK (claimed_value >= 0 AND claimed_value <= face_value),
  -- Owner and claim time stand or fall together, so a half-claimed row cannot
  -- exist.
  CONSTRAINT gift_card_codes_claim_pair_check
    CHECK ((claimed_by IS NULL) = (claimed_at IS NULL)),
  -- A revoked card is dead money: it must not leave value in a wallet.
  CONSTRAINT gift_card_codes_revoked_unclaimed_check
    CHECK (status <> 'REVOKED' OR claimed_by IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_codes_uuid_key ON gift_card_codes(uuid);
CREATE INDEX IF NOT EXISTS gift_card_codes_template_idx ON gift_card_codes(template_id);
CREATE INDEX IF NOT EXISTS gift_card_codes_claimed_by_idx ON gift_card_codes(claimed_by);
CREATE INDEX IF NOT EXISTS gift_card_codes_status_idx ON gift_card_codes(status);
CREATE INDEX IF NOT EXISTS gift_card_codes_revoked_by_idx
  ON gift_card_codes(revoked_by) WHERE revoked_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS gift_card_codes_expires_at_idx ON gift_card_codes(expires_at);

-- A template's spend restrictions, one row each instead of a JSON blob, so they
-- can be indexed and queried ("which templates are restricted to this brand").
-- An empty set means unrestricted, not restricted-to-nothing: the absence of
-- rows is the whole signal and must stay a valid, cheap state.
CREATE TABLE IF NOT EXISTS gift_card_applicability (
  id          BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('BRAND', 'CATEGORY', 'PRODUCT')),
  value       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The admin form re-saves a template's whole scope, so without this a
  -- double-save would multiply the restriction and apply it twice.
  CONSTRAINT gift_card_applicability_template_kind_value_key
    UNIQUE (template_id, kind, value)
);
-- The unique index already serves lookups by template_id; this one serves the
-- reverse question.
CREATE INDEX IF NOT EXISTS gift_card_applicability_kind_value_idx
  ON gift_card_applicability(kind, value);

-- Sending a code to its recipient. "Did they get it" is what support is asked,
-- so the send is a row rather than a side effect. SKIPPED exists because SMS has
-- no provider configured yet — recording the attempt honestly beats dropping it.
CREATE TABLE IF NOT EXISTS gift_card_deliveries (
  id              BIGSERIAL PRIMARY KEY,
  uuid            UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  code_id         BIGINT NOT NULL REFERENCES gift_card_codes(id) ON DELETE CASCADE,
  purchase_id     BIGINT REFERENCES gift_card_purchases(id) ON DELETE SET NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('EMAIL', 'SMS')),
  -- The destination for both channels: the contact detail the sender gave, so
  -- the worker has one field to hand the provider.
  recipient_email TEXT NOT NULL,
  recipient_name  TEXT,
  -- NULL means send now; a time in the past is a due row, not an error.
  scheduled_for   TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempt_count   INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error      TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_deliveries_uuid_key ON gift_card_deliveries(uuid);
-- One outstanding send per code, so a restarted worker cannot mail the same gift
-- twice. Filtered to PENDING on purpose: sent and failed rows stay as history,
-- and a resend after a failure becomes a new PENDING row.
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_deliveries_one_pending_per_code
  ON gift_card_deliveries(code_id) WHERE status = 'PENDING';
-- Due work for the worker. SENDING is included because a worker killed mid-send
-- strands a row there, and that is exactly the row to pick up again.
CREATE INDEX IF NOT EXISTS gift_card_deliveries_due_idx
  ON gift_card_deliveries(scheduled_for) WHERE status IN ('PENDING', 'SENDING');

-- A code spent at checkout. The partial unique index below is the double-spend
-- guard: two concurrent checkouts both insert ACTIVE and only one can.
--
-- A hard UNIQUE (code_id) would be simpler and wrong: refunding an order
-- reverses the redemption and restores the value, and the customer is then
-- entitled to spend that same card again. With a hard unique the respend could
-- never be recorded, so the value would sit in the wallet permanently
-- unaccounted for at checkout. A reversal therefore marks its row REVERSED
-- instead of deleting it, and only live rows count towards uniqueness.
CREATE TABLE IF NOT EXISTS gift_card_redemptions (
  id        BIGSERIAL PRIMARY KEY,
  uuid      UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  code_id   BIGINT NOT NULL REFERENCES gift_card_codes(id) ON DELETE CASCADE,
  -- The order may not exist when the redemption is written, so order_uuid
  -- carries the identity in the meantime and order_id is filled in on commit.
  order_id  BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  order_uuid UUID,
  amount    NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status    TEXT NOT NULL DEFAULT 'ACTIVE'
            CHECK (status IN ('ACTIVE', 'REVERSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_redemptions_uuid_key ON gift_card_redemptions(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_redemptions_active_code_key
  ON gift_card_redemptions(code_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS gift_card_redemptions_order_id_idx ON gift_card_redemptions(order_id);
CREATE INDEX IF NOT EXISTS gift_card_redemptions_order_uuid_idx ON gift_card_redemptions(order_uuid);

-- One wallet per customer, with no balance column on purpose. A stored total is
-- a second source of truth for a fact the ledger already holds, and it drifts
-- the first time a transaction and its balance update diverge — with nothing in
-- the database noticing. The balance is the SUM, and the overdraft guard lives
-- on the ledger's own balance_after, where Postgres can enforce it.
CREATE TABLE IF NOT EXISTS customer_wallets (
  id          BIGSERIAL PRIMARY KEY,
  uuid        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  currency    TEXT NOT NULL DEFAULT 'INR',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Becomes UNIQUE (customer_id, currency) if multi-currency wallets are ever
  -- needed; until then currency only records what this wallet holds.
  CONSTRAINT customer_wallets_customer_id_key UNIQUE (customer_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_wallets_uuid_key ON customer_wallets(uuid);

-- Wallet buckets: one row per claim, holding the remainder and the
-- applicability it inherited. A restricted bucket's money can only pay for what
-- its card allowed, so the balance is a set of buckets, not a single number.
CREATE TABLE IF NOT EXISTS customer_wallet_buckets (
  id             BIGSERIAL PRIMARY KEY,
  uuid           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  wallet_id      BIGINT NOT NULL REFERENCES customer_wallets(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: revoking a code must not delete value the customer
  -- already holds. Reversal goes through the ledger.
  code_id        BIGINT REFERENCES gift_card_codes(id) ON DELETE SET NULL,
  currency       TEXT NOT NULL DEFAULT 'INR',
  initial_value  NUMERIC(12,2) NOT NULL CHECK (initial_value >= 0),
  remaining      NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Frozen at claim time, empty array means unrestricted.
  applicability  JSONB NOT NULL DEFAULT '[]',
  expires_at     TIMESTAMPTZ,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The database-level reason a customer balance is trustworthy.
  CONSTRAINT customer_wallet_buckets_remaining_check CHECK (remaining >= 0),
  CONSTRAINT customer_wallet_buckets_remaining_cap CHECK (remaining <= initial_value)
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_wallet_buckets_uuid_key ON customer_wallet_buckets(uuid);
-- A code is claimed once, so it can only open one live bucket.
CREATE UNIQUE INDEX IF NOT EXISTS customer_wallet_buckets_code_key
  ON customer_wallet_buckets(code_id) WHERE code_id IS NOT NULL AND is_active;
CREATE INDEX IF NOT EXISTS customer_wallet_buckets_wallet_idx
  ON customer_wallet_buckets(wallet_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS customer_wallet_buckets_expiry_idx
  ON customer_wallet_buckets(expires_at) WHERE is_active;

-- The wallet ledger: append-only, since corrections are new rows rather than
-- edits. Every row carries the total *after* it applied, so the ledger audits
-- itself — a balance can be read off any row and a broken sum shows up as a
-- discontinuity instead of a plausible wrong number.
CREATE TABLE IF NOT EXISTS customer_reward_transactions (
  id            BIGSERIAL PRIMARY KEY,
  uuid          UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  wallet_id     BIGINT NOT NULL REFERENCES customer_wallets(id) ON DELETE CASCADE,
  type          TEXT NOT NULL
                CHECK (type IN ('CREDIT', 'DEBIT', 'REFUND', 'EXPIRY', 'ADJUSTMENT')),
  -- A signed delta, not a magnitude: DEBIT is negative, REFUND is positive.
  -- Magnitudes alone would force the sign to be inferred from `type`, and every
  -- new type added later would carry its sign by convention.
  amount        NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  -- The bucket this moved, so a refund can return value to the same one the
  -- debit came from. SET NULL keeps the ledger row intact if a bucket goes.
  bucket_id     BIGINT REFERENCES customer_wallet_buckets(id) ON DELETE SET NULL,
  code_id       BIGINT REFERENCES gift_card_codes(id) ON DELETE SET NULL,
  order_uuid    UUID,
  -- Why the row exists, filterable: 'CLAIM', 'REDEEM', 'ORDER:<uuid>'.
  reference     TEXT,
  description   TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The overdraft guard, in the database. A bug that debits more than the
  -- customer holds cannot be written at all: it would have to record a negative
  -- balance_after, and this CHECK refuses the row.
  CONSTRAINT customer_reward_transactions_balance_after_check
    CHECK (balance_after >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_reward_transactions_uuid_key ON customer_reward_transactions(uuid);
CREATE INDEX IF NOT EXISTS customer_reward_transactions_wallet_idx ON customer_reward_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS customer_reward_transactions_code_idx ON customer_reward_transactions(code_id);
-- Statement order and the wallet's history together, which is how a balance is
-- reconciled.
CREATE INDEX IF NOT EXISTS customer_reward_transactions_wallet_created_idx
  ON customer_reward_transactions(wallet_id, created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id            BIGSERIAL PRIMARY KEY,
  order_id      BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    BIGINT REFERENCES products(id) ON DELETE SET NULL,
  product_uuid  UUID,
  product_name  TEXT NOT NULL DEFAULT '',
  sku           TEXT NOT NULL DEFAULT '',
  variant       TEXT,
  price         NUMERIC(12,2) NOT NULL DEFAULT 0,
  quantity      INTEGER NOT NULL DEFAULT 1,
  subtotal      NUMERIC(12,2) NOT NULL DEFAULT 0
);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_id BIGINT REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_uuid UUID;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name TEXT NOT NULL DEFAULT '';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sku TEXT NOT NULL DEFAULT '';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS price NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items(order_id);
CREATE INDEX IF NOT EXISTS order_items_product_id_idx ON order_items(product_id);

-- =============================================================
-- reviews
-- Customer ratings that require admin moderation before display.
-- =============================================================
CREATE TABLE IF NOT EXISTS reviews (
  id             BIGSERIAL PRIMARY KEY,
  uuid           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  product_id     BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id    BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  customer_name  TEXT NOT NULL DEFAULT '',
  rating         INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title          TEXT NOT NULL DEFAULT '',
  comment        TEXT NOT NULL DEFAULT '',
  images         JSONB NOT NULL DEFAULT '[]',
  status         TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  admin_response TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT '';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS admin_response TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS reviews_uuid_key ON reviews(uuid);

-- =============================================================
-- banners
-- =============================================================
CREATE TABLE IF NOT EXISTS banners (
  id          BIGSERIAL PRIMARY KEY,
  uuid        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  title       TEXT NOT NULL DEFAULT '',
  subtitle    TEXT NOT NULL DEFAULT '',
  image       TEXT,
  link        TEXT NOT NULL DEFAULT '',
  position    TEXT NOT NULL DEFAULT 'hero'
              CHECK (position IN ('hero', 'promo')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ
);

ALTER TABLE banners ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE banners ADD COLUMN IF NOT EXISTS subtitle TEXT NOT NULL DEFAULT '';
ALTER TABLE banners ADD COLUMN IF NOT EXISTS image TEXT;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS link TEXT NOT NULL DEFAULT '';
ALTER TABLE banners ADD COLUMN IF NOT EXISTS position TEXT NOT NULL DEFAULT 'hero';
ALTER TABLE banners ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE banners ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE banners ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;
-- The schedule index covers starts_at/ends_at, so it has to come after the
-- backfills that add them on an existing database.
CREATE INDEX IF NOT EXISTS banners_schedule_idx ON banners(status, position, starts_at, ends_at);
CREATE UNIQUE INDEX IF NOT EXISTS banners_uuid_key ON banners(uuid);

-- =============================================================
-- countries + states + cities
-- Geographic reference data. `branches` points at these three by uuid
-- (countryid / stateid / cityid), so they are created before it.
--
-- The live database carries 250 countries, 5308 states and 152646 cities.
-- That data is NOT created here: this file only creates the structure, so
-- running it - even twice, even on a populated database - cannot touch those
-- rows. A fresh install gets an empty, structurally identical reference set;
-- load the data separately.
-- =============================================================
CREATE TABLE IF NOT EXISTS countries (
  id         BIGSERIAL PRIMARY KEY,
  uuid       UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name       TEXT NOT NULL UNIQUE,
  iso2       TEXT NOT NULL UNIQUE,
  iso3       TEXT,
  dialcode   TEXT,
  flag       TEXT,
  status     TEXT NOT NULL DEFAULT 'ACTIVE'
             CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS countries_uuid_key ON countries(uuid);

CREATE TABLE IF NOT EXISTS states (
  id         BIGSERIAL PRIMARY KEY,
  uuid       UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name       TEXT NOT NULL,
  statecode  TEXT,
  countryid  UUID NOT NULL REFERENCES countries(uuid) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'ACTIVE'
             CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (countryid, statecode)
);

CREATE UNIQUE INDEX IF NOT EXISTS states_uuid_key ON states(uuid);
CREATE INDEX IF NOT EXISTS states_country_idx ON states(countryid);

CREATE TABLE IF NOT EXISTS cities (
  id         BIGSERIAL PRIMARY KEY,
  uuid       UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name       TEXT NOT NULL,
  countryid  UUID REFERENCES countries(uuid) ON DELETE CASCADE,
  stateid    UUID NOT NULL REFERENCES states(uuid) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'ACTIVE'
             CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stateid, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS cities_uuid_key ON cities(uuid);
CREATE INDEX IF NOT EXISTS cities_country_idx ON cities(countryid);
CREATE INDEX IF NOT EXISTS cities_state_idx ON cities(stateid);
CREATE INDEX IF NOT EXISTS cities_name_idx ON cities(name);

-- =============================================================
-- branches
-- A branch is a physical store the customer can order from. Store
-- managers (branch_users rows) manage its products, stock and orders
-- from the store panel.
--
-- Every column here except `onboarding_completed` is folded lowercase: the
-- table was created with unquoted camelCase names that PostgreSQL folded.
-- =============================================================
CREATE TABLE IF NOT EXISTS branches (
  id                    BIGSERIAL PRIMARY KEY,
  uuid                  UUID NOT NULL DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  code                  TEXT NOT NULL,
  phone                 TEXT,
  email                 TEXT,
  address               TEXT,
  addressline1          TEXT,
  addressline2          TEXT,
  city                  TEXT,
  state                 TEXT,
  country               TEXT DEFAULT 'India',
  postalcode            TEXT,
  latitude              NUMERIC(10,7),
  longitude             NUMERIC(10,7),
  openingtime           TIME,
  closingtime           TIME,
  timezone              TEXT DEFAULT 'Asia/Kolkata',
  status                TEXT NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'INACTIVE')),
  deliveryenabled       BOOLEAN NOT NULL DEFAULT TRUE,
  pickupenabled         BOOLEAN NOT NULL DEFAULT TRUE,
  deliveryradius        NUMERIC(10,2),
  createdat             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updatedat             TIMESTAMPTZ NOT NULL DEFAULT now(),
  onboarding_completed  BOOLEAN NOT NULL DEFAULT FALSE,
  description           TEXT,
  logo                  TEXT,
  countryid             UUID REFERENCES countries(uuid),
  stateid               UUID REFERENCES states(uuid),
  cityid                UUID REFERENCES cities(uuid)
);

ALTER TABLE branches ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS logo TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS countryid UUID REFERENCES countries(uuid);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS stateid UUID REFERENCES states(uuid);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS cityid UUID REFERENCES cities(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS branches_uuid_key ON branches(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS branches_code_key ON branches(code);
CREATE INDEX IF NOT EXISTS branches_city_idx ON branches(city);
CREATE INDEX IF NOT EXISTS branches_postal_code_idx ON branches(postalcode);

-- =============================================================
-- branch_users
-- Maps a user to the branch(es) they manage.
-- =============================================================
CREATE TABLE IF NOT EXISTS branch_users (
  id         BIGSERIAL PRIMARY KEY,
  uuid       UUID NOT NULL DEFAULT gen_random_uuid(),
  branchid   BIGINT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  userid     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'BRANCH_MANAGER',
  createdat  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branchid, userid)
);

CREATE UNIQUE INDEX IF NOT EXISTS branch_users_uuid_key ON branch_users(uuid);
-- Redundant with branch_users_uuid_key, but the live database has both, so a
-- fresh install does too.
CREATE UNIQUE INDEX IF NOT EXISTS bu_uuid_key ON branch_users(uuid);
CREATE INDEX IF NOT EXISTS bu_branch_idx ON branch_users(branchid);
CREATE INDEX IF NOT EXISTS bu_user_idx ON branch_users(userid);

-- =============================================================
-- branch_products
-- Per-branch pricing and stock for a product (or variant).
-- =============================================================
CREATE TABLE IF NOT EXISTS branch_products (
  id                BIGSERIAL PRIMARY KEY,
  uuid              UUID NOT NULL DEFAULT gen_random_uuid(),
  branchid          BIGINT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  productid         BIGINT REFERENCES products(id) ON DELETE CASCADE,
  productuuid       UUID REFERENCES products(uuid),
  variantid         TEXT,
  sellingprice      NUMERIC(12,2),
  compareatprice    NUMERIC(12,2),
  costprice         NUMERIC(12,2),
  stockquantity     INTEGER NOT NULL DEFAULT 0,
  reservedquantity  INTEGER NOT NULL DEFAULT 0,
  availablequantity INTEGER GENERATED ALWAYS AS (stockquantity - reservedquantity) STORED NOT NULL,
  lowstockthreshold INTEGER NOT NULL DEFAULT 5,
  isavailable       BOOLEAN NOT NULL DEFAULT TRUE,
  status            TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'INACTIVE', 'OUT_OF_STOCK', 'DISCONTINUED')),
  createdat         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updatedat         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branchid, productid)
);

CREATE UNIQUE INDEX IF NOT EXISTS branch_products_uuid_key ON branch_products(uuid);
CREATE INDEX IF NOT EXISTS bp_branch_idx ON branch_products(branchid);
CREATE INDEX IF NOT EXISTS bp_product_idx ON branch_products(productid);
CREATE INDEX IF NOT EXISTS bp_status_idx ON branch_products(status);
CREATE INDEX IF NOT EXISTS bp_variant_idx ON branch_products(variantid);

-- =============================================================
-- branch_inventory_transactions
-- Ledger of stock changes per branch (purchases, orders, returns, ...).
-- =============================================================
CREATE TABLE IF NOT EXISTS branch_inventory_transactions (
  id              BIGSERIAL PRIMARY KEY,
  uuid            UUID NOT NULL DEFAULT gen_random_uuid(),
  branchid        BIGINT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  productid       BIGINT REFERENCES products(id) ON DELETE SET NULL,
  productuuid     UUID REFERENCES products(uuid),
  variantid       TEXT,
  transactiontype TEXT NOT NULL
                  CHECK (transactiontype IN ('PURCHASE','ORDER','RETURN','DAMAGE','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT')),
  quantity        INTEGER NOT NULL,
  previousstock   INTEGER NOT NULL DEFAULT 0,
  newstock        INTEGER NOT NULL DEFAULT 0,
  referencetype   TEXT,
  referenceid     UUID,
  reason          TEXT,
  createdby       BIGINT REFERENCES users(id),
  createdat       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS branch_inventory_transactions_uuid_key ON branch_inventory_transactions(uuid);
CREATE INDEX IF NOT EXISTS bit_branch_idx ON branch_inventory_transactions(branchid);
CREATE INDEX IF NOT EXISTS bit_product_idx ON branch_inventory_transactions(productid);
CREATE INDEX IF NOT EXISTS bit_created_idx ON branch_inventory_transactions(createdat);
CREATE INDEX IF NOT EXISTS bit_reference_idx ON branch_inventory_transactions(referencetype, referenceid);
CREATE INDEX IF NOT EXISTS bit_transaction_type_idx ON branch_inventory_transactions(transactiontype);

-- =============================================================
-- branch_stock_transfers + branch_transfer_items
-- Move stock between branches.
-- =============================================================
CREATE TABLE IF NOT EXISTS branch_stock_transfers (
  id                   BIGSERIAL PRIMARY KEY,
  uuid                 UUID NOT NULL DEFAULT gen_random_uuid(),
  transfernumber       TEXT NOT NULL,
  sourcebranchid       BIGINT NOT NULL REFERENCES branches(id),
  destinationbranchid  BIGINT NOT NULL REFERENCES branches(id),
  status               TEXT NOT NULL DEFAULT 'REQUESTED'
                       CHECK (status IN ('REQUESTED','APPROVED','IN_TRANSIT','RECEIVED','CANCELLED')),
  requestbyid          BIGINT REFERENCES users(id),
  approvedbyid         BIGINT REFERENCES users(id),
  receivedbyid         BIGINT REFERENCES users(id),
  reason               TEXT,
  createdat            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updatedat            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS branch_stock_transfers_uuid_key ON branch_stock_transfers(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS bst_transfer_number_key ON branch_stock_transfers(transfernumber);
CREATE INDEX IF NOT EXISTS bst_source_idx ON branch_stock_transfers(sourcebranchid);
CREATE INDEX IF NOT EXISTS bst_dest_idx ON branch_stock_transfers(destinationbranchid);
CREATE INDEX IF NOT EXISTS bst_status_idx ON branch_stock_transfers(status);

CREATE TABLE IF NOT EXISTS branch_transfer_items (
  id                   BIGSERIAL PRIMARY KEY,
  uuid                 UUID NOT NULL DEFAULT gen_random_uuid(),
  transferid           BIGINT NOT NULL REFERENCES branch_stock_transfers(id) ON DELETE CASCADE,
  productid            BIGINT REFERENCES products(id) ON DELETE SET NULL,
  productuuid          UUID REFERENCES products(uuid),
  variantid            TEXT,
  quantity             INTEGER NOT NULL,
  previousstocksource  INTEGER,
  previousstockdest    INTEGER,
  createdat            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS branch_transfer_items_uuid_key ON branch_transfer_items(uuid);
CREATE INDEX IF NOT EXISTS bti_transfer_idx ON branch_transfer_items(transferid);
CREATE INDEX IF NOT EXISTS bti_product_idx ON branch_transfer_items(productid);

-- Orders belong to a branch when placed against one. branches is created after
-- orders (orders is referenced by order_items and order_status_history), so
-- these two columns are added by ALTER rather than declared inline. Written in
-- the folded spelling the live database has.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS branchid BIGINT REFERENCES branches(id);
CREATE INDEX IF NOT EXISTS orders_branch_idx ON orders(branchid);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS branchid BIGINT REFERENCES branches(id);
CREATE INDEX IF NOT EXISTS order_items_branch_idx ON order_items(branchid);

-- Estimated delivery timestamp promised to the customer at checkout.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_delivery_at TIMESTAMPTZ;

-- Order status audit trail: one row per status transition so customers can
-- see WHEN each step happened and stores/admins get an auditable timeline.
CREATE TABLE IF NOT EXISTS order_status_history (
  id         BIGSERIAL PRIMARY KEY,
  order_id   BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS osh_order_idx ON order_status_history(order_id);
CREATE INDEX IF NOT EXISTS osh_status_idx ON order_status_history(status);
