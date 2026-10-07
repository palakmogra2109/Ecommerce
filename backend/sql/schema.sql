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

-- ============================================================================
-- Invoicing and stock management
-- --------------------------------------------------------------------------
-- Mirrors sql/migrations/021-invoicing-stock-foundation.sql. Appended last on
-- purpose: stock_ledger references warehouses, suppliers, products and
-- branches, and returns/credit_notes reference sales_invoices and
-- purchase_invoices, so it can only come after all of them.
--
-- Every statement below is IF NOT EXISTS, so re-running is a no-op.
-- ============================================================================

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
                  'SALES_RETURN', 'CREDIT_NOTE', 'STOCK_TRANSFER',
                  'STOCK_RECEIPT'
                )),
  series        TEXT NOT NULL DEFAULT 'DEFAULT',
  prefix        TEXT NOT NULL DEFAULT '',
  -- %s is the running number. prefix supplies the label, so format stays
  -- '%s' and 'PI-' renders PI-000001. Migration 022 repaired the seeds,
  -- which had the prefix in both places and rendered PI-PI-000001.
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
  ('PURCHASE_INVOICE', 'DEFAULT', 'PI-',  '%s', 6),
  ('PURCHASE_RETURN',  'DEFAULT', 'PR-',  '%s', 6),
  ('SALES_INVOICE',    'DEFAULT', 'SI-',  '%s', 6),
  ('SALES_RETURN',     'DEFAULT', 'SR-',  '%s', 6),
  ('CREDIT_NOTE',      'DEFAULT', 'CN-',  '%s', 6),
  -- Deliberately a document number and NOT a tax invoice: an internal stock
  -- movement is not a supply of goods to a customer and must not be numbered
  -- from the sales-invoice series. The spec calls this out explicitly.
  ('STOCK_TRANSFER',   'DEFAULT', 'ST-',  '%s', 6),
  -- A goods receipt is a numbered document, so a supplier shortage can be
  -- settled against the receipt number. Added by migration 022.
  ('STOCK_RECEIPT',    'DEFAULT', 'GR-',  '%s', 6)
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
  batch_number      TEXT,
  expiry_date       DATE,
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

-- Per-batch stock (§12). Exists from migration 029; mirrored here so the
-- scratch schema gets it here too. No FOREIGN KEYs in the live schema,
-- so the definition below mirrors it exactly without FK indirection.
CREATE TABLE IF NOT EXISTS product_batches (
  id               BIGSERIAL PRIMARY KEY,
  uuid             UUID NOT NULL DEFAULT gen_random_uuid(),
  batch_number     TEXT NOT NULL,
  product_id       BIGINT NOT NULL,
  variant_uuid     TEXT,
  supplier_id      BIGINT,
  purchase_invoice_id BIGINT,
  stock_receipt_id BIGINT,
  warehouse_id     BIGINT,
  branch_id        BIGINT,
  unit_id          BIGINT,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  manufacturing_date DATE,
  expiry_date      DATE,
  quantity_received NUMERIC(18,4) NOT NULL
    CHECK (quantity_received > 0),
  quantity_remaining NUMERIC(18,4) NOT NULL
    CHECK (quantity_remaining >= 0 AND quantity_remaining <= quantity_received),
  quantity_reserved NUMERIC(18,4) NOT NULL DEFAULT 0
    CHECK (quantity_reserved >= 0),
  cost_price       NUMERIC(12,2)
    CHECK (cost_price IS NULL OR cost_price >= 0),
  status           TEXT NOT NULL DEFAULT 'AVAILABLE'
    CHECK (status IN ('AVAILABLE','NEAR_EXPIRY','EXPIRED','BLOCKED','DAMAGED','DEPLETED','RETURNED')),
  notes            TEXT,
  created_by       BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_batches_location_check CHECK (
    (warehouse_id IS NOT NULL AND branch_id IS NULL) OR
    (warehouse_id IS NULL AND branch_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS product_batches_product_idx
  ON product_batches (product_id);
CREATE INDEX IF NOT EXISTS product_batches_variant_idx
  ON product_batches (product_id, variant_uuid);

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
  batch_id        BIGINT,
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

-- Supplier bank accounts, from sql/migrations/024-supplier-bank-accounts.sql.
-- Additive and idempotent, so it is safe to replay on top of this schema.

CREATE TABLE IF NOT EXISTS supplier_bank_accounts (
  id             BIGSERIAL PRIMARY KEY,
  uuid           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  supplier_id    BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,

  account_name   TEXT NOT NULL,
  bank_name      TEXT NOT NULL,
  -- Between 6 and 20 digits, which covers Indian accounts and most foreign ones.
  account_number TEXT NOT NULL CHECK (account_number ~ '^[0-9]{6,20}$'),
  -- IFSC is 11 characters: 4 bank code, the letter 0, then 6 branch characters.
  -- Nullable, because an overseas account has no IFSC.
  ifsc           TEXT CHECK (ifsc IS NULL OR ifsc ~ '^[A-Z0-9]{1,11}$'),
  swift_code     TEXT CHECK (swift_code IS NULL OR swift_code ~ '^[A-Z0-9]{8,11}$'),
  branch         TEXT,
  account_type   TEXT NOT NULL DEFAULT 'CURRENT'
                 CHECK (account_type IN ('SAVINGS', 'CURRENT')),

  is_primary     BOOLEAN NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  notes          TEXT,

  created_by     BIGINT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A supplier has at most one primary account. The partial unique index is what
-- makes that true: retiring the old primary and setting a new one are separate
-- statements, so the second one can transiently collide and must be done inside
-- a transaction.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_bank_accounts_one_primary_idx
  ON supplier_bank_accounts (supplier_id) WHERE is_primary;

CREATE INDEX IF NOT EXISTS supplier_bank_accounts_supplier_idx
  ON supplier_bank_accounts (supplier_id);

-- An account is not a bank account without a bank and a holder, which is why
-- account_name is NOT NULL and length-checked rather than defaulted to ''.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_bank_accounts_name_check'
      AND conrelid = 'supplier_bank_accounts'::regclass
  ) THEN
    ALTER TABLE supplier_bank_accounts
      ADD CONSTRAINT supplier_bank_accounts_name_check
      CHECK (length(btrim(account_name)) > 0 AND length(btrim(bank_name)) > 0);
  END IF;
END;
$$;

-- Bank details are edited often and viewed often, and are sensitive enough to
-- deserve their own grant rather than riding on suppliers.update.
INSERT INTO permissions (name, slug, module, description) VALUES
  ('View Supplier Bank Details',  'suppliers.bank.view',   'suppliers',
   'See supplier bank accounts and masked account numbers'),
  ('Manage Supplier Bank Details','suppliers.bank.manage', 'suppliers',
   'Add, edit and retire supplier bank accounts')
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      module = EXCLUDED.module,
      description = EXCLUDED.description;

-- From sql/migrations/025 and 027: an IFSC is letters and digits up to 11
-- characters. The exact Indian layout rejected both HDFC0001234 (025) and
-- FD433424244 (027), and an overseas account has no IFSC at all.
ALTER TABLE supplier_bank_accounts DROP CONSTRAINT IF EXISTS supplier_bank_accounts_ifsc_check;
ALTER TABLE supplier_bank_accounts
  ADD CONSTRAINT supplier_bank_accounts_ifsc_check
  CHECK (ifsc IS NULL OR ifsc ~ '^[A-Z0-9]{1,11}$');

-- From sql/migrations/026-grant-purchase-permissions.sql: grant the suppliers.* and
-- purchase_invoices.* permissions to the `admin` role. Without this only super_admin
-- could see the Purchases section or the supplier bank icon.

INSERT INTO role_has_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  CROSS JOIN permissions p
 WHERE r.slug = 'admin'
   AND (
     p.slug LIKE 'suppliers.%'
     OR p.slug LIKE 'purchase_invoices.%'
   )
ON CONFLICT DO NOTHING;

-- From sql/migrations/028-po-selling-price.sql: the purchase invoice sets the
-- product's selling price. unit_cost stays the supplier cost.

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

-- From sql/migrations/030-minimum-order-value.sql: Minimum Order Value setting
-- and its change history. Additive and idempotent.

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

-- From sql/migrations/031-notifications.sql: the single notification pipeline
-- (templates, devices, preferences, inbox, deliveries) plus notify-me interest.

CREATE TABLE IF NOT EXISTS notification_templates (
  id           BIGSERIAL PRIMARY KEY,
  uuid         UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  -- Dotted, uppercase, matching the event name passed to NotificationService.
  event        TEXT NOT NULL UNIQUE,
  category     TEXT NOT NULL DEFAULT 'GENERAL'
               CHECK (category IN ('GENERAL', 'ORDER', 'INVENTORY', 'TRANSFER', 'PURCHASE', 'CUSTOMER', 'SYSTEM')),
  title_template  TEXT NOT NULL,
  body_template   TEXT NOT NULL,
  default_priority TEXT NOT NULL DEFAULT 'NORMAL'
                 CHECK (default_priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  default_channels TEXT[] NOT NULL DEFAULT ARRAY['IN_APP']::TEXT[],
  -- Optional deep link. A module supplies entity info; the template decides
  -- where the notification points.
  action_url_template TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Recipients and devices
-- ─────────────────────────────────────────────────────────────────────────────

-- Push/FCM tokens. Kept apart from the inbox so a delivery to one device never
-- affects the in-app record.
CREATE TABLE IF NOT EXISTS notification_devices (
  id          BIGSERIAL PRIMARY KEY,
  uuid        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  user_id     BIGINT REFERENCES users(id) ON DELETE CASCADE,
  -- A customer with no user row still gets push.
  customer_id BIGINT REFERENCES customers(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  platform    TEXT NOT NULL DEFAULT 'WEB' CHECK (platform IN ('WEB', 'ANDROID', 'IOS')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_devices_owner_check CHECK (
    (user_id IS NOT NULL AND customer_id IS NULL) OR
    (user_id IS NULL AND customer_id IS NOT NULL)
  )
);

-- Per-user, per-event, per-channel opt-out. A missing row means "subscribed",
-- which is the useful default: nobody has to be opted in to hear about their
-- own order.
CREATE TABLE IF NOT EXISTS notification_preferences (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id BIGINT REFERENCES customers(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,
  channel     TEXT NOT NULL CHECK (channel IN ('IN_APP', 'PUSH', 'EMAIL', 'SMS', 'WHATSAPP')),
  -- Tri-state: TRUE/anything = allowed, FALSE = opted out, NULL = category default.
  enabled     BOOLEAN,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_preferences_owner_check CHECK (
    (user_id IS NOT NULL AND customer_id IS NULL) OR
    (user_id IS NULL AND customer_id IS NOT NULL)
  )
);

-- The "Notify me" list. One row per product per customer, so asking twice
-- updates rather than duplicates.
CREATE TABLE IF NOT EXISTS product_stock_notifications (
  id          BIGSERIAL PRIMARY KEY,
  uuid        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  product_id  BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id BIGINT REFERENCES customers(id) ON DELETE CASCADE,
  -- The shopper may not be logged in; email is then the only handle.
  email       TEXT NOT NULL,
  -- Optional, so a storefront can pre-fill it from a previously used address.
  name        TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ,
  -- Retained after a notification so the shopper is not told twice about the
  -- same restock.
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_stock_notifications_unique UNIQUE (product_id, email)
);

CREATE INDEX IF NOT EXISTS product_stock_notifications_product_idx
  ON product_stock_notifications (product_id) WHERE is_active AND notified_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- The inbox and delivery log
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per recipient per event occurrence: the in-app notification itself,
-- and the history every module shares.
CREATE TABLE IF NOT EXISTS notifications (
  id           BIGSERIAL PRIMARY KEY,
  uuid         UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  event        TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'GENERAL',
  priority     TEXT NOT NULL DEFAULT 'NORMAL'
               CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),

  user_id      BIGINT REFERENCES users(id) ON DELETE CASCADE,
  customer_id  BIGINT REFERENCES customers(id) ON DELETE CASCADE,
  -- Set when the recipient could not be tied to a row: a raw email that asked
  -- to be notified, for example.
  recipient_email TEXT,

  title        TEXT NOT NULL,
  message      TEXT NOT NULL,
  -- The render variables, kept so a later change to a template cannot silently
  -- rewrite what was actually sent.
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_url   TEXT,

  entity_type  TEXT,
  entity_id    TEXT,
  branch_id    BIGINT REFERENCES branches(id) ON DELETE SET NULL,

  -- Business-level id supplied by the calling module, e.g.
  -- "stock_transfer_received:12345". Combined with recipient and channel it is
  -- the idempotency key, so a retried or double-fired event cannot notify twice.
  dedupe_key   TEXT,

  status       TEXT NOT NULL DEFAULT 'PENDING'
               CHECK (status IN ('PENDING', 'SENT', 'PARTIAL', 'FAILED', 'SUPPRESSED')),

  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at      TIMESTAMPTZ,
  created_by_event_at TIMESTAMPTZ,
  CONSTRAINT notifications_recipient_check CHECK (
    user_id IS NOT NULL OR customer_id IS NOT NULL OR recipient_email IS NOT NULL
  )
);

-- The partial unique index is what makes duplicate protection central and
-- race-safe: two concurrent sends of the same event for the same recipient
-- cannot both insert.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
  ON notifications (dedupe_key, user_id, customer_id, COALESCE(recipient_email, ''))
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_inbox_idx
  ON notifications (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_customer_inbox_idx
  ON notifications (customer_id, created_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_entity_idx
  ON notifications (entity_type, entity_id);

-- One row per channel attempt, so a push failure is retried without resending
-- the in-app copy, and delivery status is one place to look.
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id            BIGSERIAL PRIMARY KEY,
  uuid          UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL CHECK (channel IN ('IN_APP', 'PUSH', 'EMAIL', 'SMS', 'WHATSAPP')),
  status        TEXT NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED', 'SUPPRESSED')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  provider      TEXT,
  provider_message_id TEXT,
  error         TEXT,
  next_retry_at TIMESTAMPTZ,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_deliveries_once UNIQUE (notification_id, channel)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed templates
-- ─────────────────────────────────────────────────────────────────────────────

-- Inserted here rather than in code so a business user can reword an alert
-- without a deploy. ON CONFLICT DO NOTHING keeps an operator's edit.
INSERT INTO notification_templates
  (event, category, title_template, body_template, default_priority, default_channels, action_url_template)
VALUES
  ('PRODUCT_BACK_IN_STOCK', 'INVENTORY',
   'Back in stock: {{product_name}}',
   'Good news — {{product_name}} is back in stock at {{branch_name}}. You asked to be told when it returned.',
   'NORMAL', ARRAY['IN_APP','PUSH'], '/products/{{product_uuid}}'),

  ('LOW_STOCK', 'INVENTORY',
   'Low stock: {{product_name}}',
   '{{product_name}} at {{branch_name}} has only {{current_stock}} {{unit}} remaining. Reorder level is {{reorder_level}} {{unit}}.',
   'HIGH', ARRAY['IN_APP'], '/inventory'),

  ('ORDER_CREATED', 'ORDER',
   'Order {{order_number}} placed',
   'We have received your order {{order_number}} for {{total}}. We will let you know when it ships.',
   'NORMAL', ARRAY['IN_APP'], '/my/orders/{{order_uuid}}'),

  ('STOCK_TRANSFER_RECEIVED', 'TRANSFER',
   'Stock transfer {{transfer_number}} received',
   'Transfer {{transfer_number}} was received at {{branch_name}} with {{received_quantity}} accepted and {{short_quantity}} short.',
   'NORMAL', ARRAY['IN_APP'], '/stock-transfers'),

  ('STOCK_TRANSFER_DISCREPANCY', 'TRANSFER',
   'Transfer discrepancy: {{transfer_number}}',
   'Transfer {{transfer_number}} to {{branch_name}} had {{short_quantity}} {{unit}} missing and {{damaged_quantity}} damaged. Please review.',
   'CRITICAL', ARRAY['IN_APP'], '/stock-transfers'),

  ('PURCHASE_RECEIVED', 'PURCHASE',
   'Purchase received: {{invoice_number}}',
   '{{received_quantity}} {{unit}} of {{product_name}} received against {{invoice_number}} from {{supplier_name}}.',
   'NORMAL', ARRAY['IN_APP'], '/purchase-invoices'),

  ('STOCK_EXPIRING', 'INVENTORY',
   'Expiring soon: {{product_name}}',
   'Batch {{batch_number}} of {{product_name}} expires on {{expiry_date}}. {{quantity_remaining}} {{unit}} remaining.',
   'HIGH', ARRAY['IN_APP'], '/inventory'),

  ('SUPPLIER_PAYMENT_DUE', 'PURCHASE',
   'Payment due to {{supplier_name}}',
   '₹{{outstanding}} is outstanding to {{supplier_name}}. Next due {{due_date}}.',
   'NORMAL', ARRAY['IN_APP'], '/suppliers')
ON CONFLICT (event) DO NOTHING;