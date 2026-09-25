-- Earth धान्य schema
-- Idempotent: safe to run on a fresh or existing database.

-- gen_random_uuid() needs the pgcrypto extension on PostgreSQL 12.
-- On PostgreSQL 13+ it is built in, so this is a no-op there.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================
-- users
-- =============================================================
CREATE TABLE IF NOT EXISTS users (
  id          BIGSERIAL PRIMARY KEY,
  uuid        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name        TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL UNIQUE,
  password    TEXT NOT NULL,
  mobile      TEXT,
  avatar      TEXT,
  parent_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill columns on existing databases
ALTER TABLE users ADD COLUMN IF NOT EXISTS uuid       UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE users ADD COLUMN IF NOT EXISTS status    TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_id  BIGINT REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_uuid_key ON users(uuid);

-- =============================================================
-- roles
-- =============================================================
CREATE TABLE IF NOT EXISTS roles (
  id          BIGSERIAL PRIMARY KEY,
  uuid        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE roles ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS roles_uuid_key ON roles(uuid);

-- =============================================================
-- permissions
-- =============================================================
CREATE TABLE IF NOT EXISTS permissions (
  id          BIGSERIAL PRIMARY KEY,
  uuid        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  module      TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
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
  uuid        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  subject     TEXT NOT NULL,
  body_html   TEXT NOT NULL,
  body_text   TEXT NOT NULL,
  variables   JSONB NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
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
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
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

-- =============================================================
-- customers
-- Billing/shipping address is kept as JSONB so it can carry any
-- set of fields without schema churn.
-- =============================================================
CREATE TABLE IF NOT EXISTS customers (
  id          BIGSERIAL PRIMARY KEY,
  uuid        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  mobile      TEXT,
  address     JSONB NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE customers ADD COLUMN IF NOT EXISTS mobile TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address JSONB NOT NULL DEFAULT '{}';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS customers_uuid_key ON customers(uuid);

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
                  CHECK (payment_method IN ('card', 'cod', 'upi')),
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
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cod';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS orders_uuid_key ON orders(uuid);

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
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE banners ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE banners ADD COLUMN IF NOT EXISTS subtitle TEXT NOT NULL DEFAULT '';
ALTER TABLE banners ADD COLUMN IF NOT EXISTS image TEXT;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS link TEXT NOT NULL DEFAULT '';
ALTER TABLE banners ADD COLUMN IF NOT EXISTS position TEXT NOT NULL DEFAULT 'hero';
ALTER TABLE banners ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE banners ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS banners_schedule_idx ON banners(status, position, starts_at, ends_at);
ALTER TABLE banners ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS banners_uuid_key ON banners(uuid);

-- =============================================================
-- branches
-- A branch is a physical store the customer can order from. Store
-- managers (branch_users rows) manage its products, stock and orders
-- from the store panel.
-- =============================================================
CREATE TABLE IF NOT EXISTS branches (
  id                  BIGSERIAL PRIMARY KEY,
  uuid                UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name                TEXT NOT NULL,
  code                TEXT NOT NULL UNIQUE,
  phone               TEXT,
  email               TEXT,
  address             TEXT,
  addressLine1        TEXT,
  addressLine2        TEXT,
  city                TEXT,
  state               TEXT,
  country             TEXT NOT NULL DEFAULT 'India',
  postalCode          TEXT,
  latitude            NUMERIC(10,7),
  longitude           NUMERIC(10,7),
  openingTime         TIME,
  closingTime         TIME,
  timezone            TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  status              TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE', 'INACTIVE')),
  deliveryEnabled     BOOLEAN NOT NULL DEFAULT TRUE,
  pickupEnabled       BOOLEAN NOT NULL DEFAULT TRUE,
  deliveryRadius      NUMERIC(10,2),
  description         TEXT,
  logo                TEXT,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE branches ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS logo TEXT;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS branches_uuid_key ON branches(uuid);
CREATE INDEX IF NOT EXISTS branches_city_idx ON branches(city);
CREATE INDEX IF NOT EXISTS branches_postal_code_idx ON branches(postalCode);

-- =============================================================
-- branch_users
-- Maps a user to the branch(es) they manage.
-- =============================================================
CREATE TABLE IF NOT EXISTS branch_users (
  id         BIGSERIAL PRIMARY KEY,
  uuid       UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  branchId   BIGINT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  userId     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'BRANCH_MANAGER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branchId, userId)
);

CREATE UNIQUE INDEX IF NOT EXISTS branch_users_uuid_key ON branch_users(uuid);
CREATE INDEX IF NOT EXISTS bu_branch_idx ON branch_users(branchId);
CREATE INDEX IF NOT EXISTS bu_user_idx ON branch_users(userId);

-- =============================================================
-- branch_products
-- Per-branch pricing and stock for a product (or variant).
-- =============================================================
CREATE TABLE IF NOT EXISTS branch_products (
  id                BIGSERIAL PRIMARY KEY,
  uuid              UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  branchId          BIGINT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  productId         BIGINT REFERENCES products(id) ON DELETE CASCADE,
  productUuid       UUID REFERENCES products(uuid),
  variantId         TEXT,
  sellingPrice      NUMERIC(12,2),
  compareAtPrice    NUMERIC(12,2),
  costPrice         NUMERIC(12,2),
  stockQuantity     INTEGER NOT NULL DEFAULT 0,
  reservedQuantity  INTEGER NOT NULL DEFAULT 0,
  availableQuantity INTEGER GENERATED ALWAYS AS (stockQuantity - reservedQuantity) STORED,
  lowStockThreshold INTEGER NOT NULL DEFAULT 5,
  isAvailable       BOOLEAN NOT NULL DEFAULT TRUE,
  status            TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'INACTIVE', 'OUT_OF_STOCK', 'DISCONTINUED')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branchId, productId)
);

CREATE UNIQUE INDEX IF NOT EXISTS branch_products_uuid_key ON branch_products(uuid);
CREATE INDEX IF NOT EXISTS bp_branch_idx ON branch_products(branchId);
CREATE INDEX IF NOT EXISTS bp_product_idx ON branch_products(productId);
CREATE INDEX IF NOT EXISTS bp_status_idx ON branch_products(status);
CREATE INDEX IF NOT EXISTS bp_variant_idx ON branch_products(variantId);

-- =============================================================
-- branch_inventory_transactions
-- Ledger of stock changes per branch (purchases, orders, returns, ...).
-- =============================================================
CREATE TABLE IF NOT EXISTS branch_inventory_transactions (
  id              BIGSERIAL PRIMARY KEY,
  uuid            UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  branchId        BIGINT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  productId       BIGINT REFERENCES products(id) ON DELETE SET NULL,
  productUuid     UUID REFERENCES products(uuid),
  variantId       TEXT,
  transactionType TEXT NOT NULL
                  CHECK (transactionType IN ('PURCHASE','ORDER','RETURN','DAMAGE','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT')),
  quantity        INTEGER NOT NULL,
  previousStock   INTEGER NOT NULL DEFAULT 0,
  newStock        INTEGER NOT NULL DEFAULT 0,
  referenceType   TEXT,
  referenceId     UUID,
  reason          TEXT,
  createdBy       BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS branch_inventory_transactions_uuid_key ON branch_inventory_transactions(uuid);
CREATE INDEX IF NOT EXISTS bit_branch_idx ON branch_inventory_transactions(branchId);
CREATE INDEX IF NOT EXISTS bit_product_idx ON branch_inventory_transactions(productId);
CREATE INDEX IF NOT EXISTS bit_created_idx ON branch_inventory_transactions(created_at);
CREATE INDEX IF NOT EXISTS bit_reference_idx ON branch_inventory_transactions(referenceType, referenceId);
CREATE INDEX IF NOT EXISTS bit_transaction_type_idx ON branch_inventory_transactions(transactionType);

-- =============================================================
-- branch_stock_transfers + branch_transfer_items
-- Move stock between branches.
-- =============================================================
CREATE TABLE IF NOT EXISTS branch_stock_transfers (
  id                  BIGSERIAL PRIMARY KEY,
  uuid                UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  transferNumber      TEXT NOT NULL UNIQUE,
  sourceBranchId      BIGINT NOT NULL REFERENCES branches(id),
  destinationBranchId BIGINT NOT NULL REFERENCES branches(id),
  status              TEXT NOT NULL DEFAULT 'REQUESTED'
                      CHECK (status IN ('REQUESTED','APPROVED','IN_TRANSIT','RECEIVED','CANCELLED')),
  requestedById       BIGINT REFERENCES users(id),
  approvedById        BIGINT REFERENCES users(id),
  receivedById        BIGINT REFERENCES users(id),
  reason              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS branch_stock_transfers_uuid_key ON branch_stock_transfers(uuid);
CREATE INDEX IF NOT EXISTS bst_source_idx ON branch_stock_transfers(sourceBranchId);
CREATE INDEX IF NOT EXISTS bst_dest_idx ON branch_stock_transfers(destinationBranchId);
CREATE INDEX IF NOT EXISTS bst_status_idx ON branch_stock_transfers(status);

CREATE TABLE IF NOT EXISTS branch_transfer_items (
  id                BIGSERIAL PRIMARY KEY,
  uuid              UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  transferId        BIGINT NOT NULL REFERENCES branch_stock_transfers(id) ON DELETE CASCADE,
  productId         BIGINT REFERENCES products(id) ON DELETE SET NULL,
  productUuid       UUID REFERENCES products(uuid),
  variantId         TEXT,
  quantity          INTEGER NOT NULL,
  previousStockSource INTEGER,
  previousStockDest INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS branch_transfer_items_uuid_key ON branch_transfer_items(uuid);
CREATE INDEX IF NOT EXISTS bti_transfer_idx ON branch_transfer_items(transferId);
CREATE INDEX IF NOT EXISTS bti_product_idx ON branch_transfer_items(productId);

-- Orders belong to a branch when placed against one.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS branchId BIGINT REFERENCES branches(id);
CREATE INDEX IF NOT EXISTS orders_branch_idx ON orders(branchId);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS branchId BIGINT REFERENCES branches(id);

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