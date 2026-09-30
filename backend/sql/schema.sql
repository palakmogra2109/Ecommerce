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

-- Gift cards: admin-issued stored value redeemed at checkout. Balances live
-- on gift_cards; every movement is audited in gift_card_transactions.
CREATE TABLE IF NOT EXISTS gift_cards (
  id               BIGSERIAL PRIMARY KEY,
  uuid             UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  code             TEXT NOT NULL UNIQUE,
  initial_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance          NUMERIC(12,2) NOT NULL DEFAULT 0,
  recipient_email  TEXT,
  status           TEXT NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'INACTIVE', 'REDEEMED')),
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_uuid_key ON gift_cards(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_code_key ON gift_cards(code);
CREATE INDEX IF NOT EXISTS gift_cards_recipient_idx ON gift_cards(recipient_email);

CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id              BIGSERIAL PRIMARY KEY,
  uuid            UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  gift_card_id    BIGINT NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  order_id        BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  type            TEXT NOT NULL CHECK (type IN ('ISSUE', 'REDEEM')),
  amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_after   NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gift_card_transactions_card_idx ON gift_card_transactions(gift_card_id);

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
