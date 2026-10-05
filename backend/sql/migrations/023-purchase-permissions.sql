-- Purchases need permissions of their own.
--
-- Migration 021 created the purchase-invoice tables but no routes, so no
-- permissions existed for them. Without rows here, authorize("invoices.view")
-- matches nothing and denies every role including super_admin's own checks
-- (super_admin short-circuits in hasPermission, but any non-superadmin role
-- would be locked out).
--
-- Receiving and paying are deliberately separate slugs from create/update:
-- the person who books what was ordered is usually not the person who counts
-- what arrived, and the person who pays the supplier is neither. One
-- purchase_invoices.view is enough to read; everything that writes money or
-- moves stock is its own grant.
--
-- Idempotent: permissions.slug is UNIQUE, so this is safe to re-run and safe
-- to run against a database where the rows already exist.

INSERT INTO permissions (name, slug, module, description) VALUES
  ('View Suppliers',           'suppliers.view',    'suppliers',
   'See the supplier list and supplier records'),
  ('Create Suppliers',         'suppliers.create',  'suppliers',
   'Add a supplier'),
  ('Update Suppliers',         'suppliers.update',  'suppliers',
   'Edit supplier details'),
  ('Delete Suppliers',         'suppliers.delete',  'suppliers',
   'Deactivate or remove a supplier'),

  ('View Purchase Invoices',   'purchase_invoices.view',    'purchase_invoices',
   'See purchase invoices and what is still outstanding'),
  ('Create Purchase Invoices', 'purchase_invoices.create',  'purchase_invoices',
   'Book a purchase invoice against a supplier'),
  ('Update Purchase Invoices', 'purchase_invoices.update',  'purchase_invoices',
   'Edit purchase invoice details before stock is received'),
  ('Cancel Purchase Invoices', 'purchase_invoices.cancel',  'purchase_invoices',
   'Cancel a purchase invoice'),
  ('Receive Purchase Stock',   'purchase_invoices.receive', 'purchase_invoices',
   'Record goods arriving and move central stock'),
  ('Pay Suppliers',            'purchase_invoices.pay',     'purchase_invoices',
   'Record a payment to a supplier')
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      module = EXCLUDED.module,
      description = EXCLUDED.description;