-- One centralized notification system: templates, preferences, devices,
-- in-app inbox, per-channel delivery log, and "notify me when back in stock".
--
-- Everything that ever notifies anybody goes through these tables. No module
-- writes its own notification rows, and no module builds its own message text.
--
-- Additive only. Nothing existing is read, rewritten or removed. No product or
-- customer row is touched, and the back-in-stock table starts empty, so nothing
-- changes behaviourally until an event is actually fired.

-- ─────────────────────────────────────────────────────────────────────────────
-- Event templates
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per event. The body is the single source of the wording, so adding an
-- event or rewording an alert is a data change, not a code change in every
-- module that happens to send it.
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