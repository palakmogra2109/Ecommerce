-- Gift cards: admin-issued stored value redeemed at storefront checkout.
--
-- Additive only. gift_cards carries the balance; every movement is audited
-- in gift_card_transactions. orders gains two nullable columns so a checkout
-- can record which card paid and how much. Nothing existing is modified.

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

ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_card_id BIGINT REFERENCES gift_cards(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Admin module vocabulary (mirrors 001-phase1-permissions.sql conventions).
INSERT INTO modules (name, slug) VALUES ('Gift Cards', 'gift_cards')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO permissions (name, slug, module, description) VALUES
  ('View Gift Cards', 'gift_cards.view', 'gift_cards', 'View gift cards and balances'),
  ('Create Gift Cards', 'gift_cards.create', 'gift_cards', 'Issue new gift cards'),
  ('Update Gift Cards', 'gift_cards.update', 'gift_cards', 'Edit gift cards and balances'),
  ('Delete Gift Cards', 'gift_cards.delete', 'gift_cards', 'Delete gift cards')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_has_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
CROSS JOIN permissions p
WHERE r.slug IN ('super_admin', 'admin')
  AND p.slug IN ('gift_cards.view', 'gift_cards.create', 'gift_cards.update', 'gift_cards.delete')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_has_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.slug = 'gift_cards.view'
WHERE r.slug = 'manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO module_has_roles (module_id, role_id)
SELECT m.id, r.id FROM modules m
JOIN roles r ON r.slug IN ('super_admin', 'admin', 'manager')
WHERE m.slug = 'gift_cards'
ON CONFLICT (module_id, role_id) DO NOTHING;
