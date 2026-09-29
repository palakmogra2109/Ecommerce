-- Phase 1: multi-branch inventory permissions.
--
-- Phase 1 turns authorize() from "any logged-in user may do anything" into a
-- real check, which means the slugs the branch routes pass to it have to exist
-- as permissions rows and be granted to the roles that are supposed to use the
-- Branches module. This migration supplies them.
--
-- Additive and idempotent by construction:
--   * every INSERT is ON CONFLICT ... DO NOTHING against a real unique key
--     (modules.slug, permissions.slug, and the two composite primary keys);
--   * nothing is dropped, truncated, updated or deleted, so the 24 users, 11
--     orders, 4 branches, 2 branch_products and the role/permission rows that
--     already exist are all preserved;
--   * `branches.*` permission rows already existed on this database before this
--     file was written, and `dashboard.view` likewise, so their inserts are
--     no-ops here. They are kept so a FRESH install converges on the same
--     vocabulary - which is the whole point of the file.

-- The `branches` module row is genuinely missing on this database: the
-- permissions below carry module='branches' but modules had no such row, so
-- module_has_roles had nothing to attach a role to and the Branches module
-- never reached a non-super-admin sidebar.
INSERT INTO modules (name, slug) VALUES ('Branches', 'branches')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO permissions (name, slug, module, description) VALUES
  ('View Branches', 'branches.view', 'branches', 'View the branch directory and branch details'),
  ('Create Branches', 'branches.create', 'branches', 'Create new branches'),
  ('Update Branches', 'branches.update', 'branches', 'Edit branch details and settings'),
  ('Delete Branches', 'branches.delete', 'branches', 'Delete branches'),
  ('View Branch Inventory', 'branches.inventory.view', 'branches', 'View branch inventory levels'),
  ('Update Branch Inventory', 'branches.inventory.update', 'branches', 'Adjust branch inventory and pricing'),
  ('View Branch Orders', 'branches.orders.view', 'branches', 'View orders placed at a branch'),
  ('Update Branch Orders', 'branches.orders.update', 'branches', 'Move branch orders through statuses'),
  ('View Branch Pricing', 'branches.price.view', 'branches', 'View branch product pricing'),
  ('Update Branch Pricing', 'branches.price.update', 'branches', 'Edit branch product pricing'),
  ('View Dashboard', 'dashboard.view', 'dashboard', 'View the admin dashboard')
ON CONFLICT (slug) DO NOTHING;

-- super_admin + admin already receive every permission row via seed; re-grant
-- defensively, because a permission inserted AFTER that seed ran (which is what
-- the six branches.inventory/orders/price rows above are) would otherwise exist
-- but be ungranted - and authorize() would then deny it to every admin.
INSERT INTO role_has_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
CROSS JOIN permissions p
WHERE r.slug IN ('super_admin', 'admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- manager subset + dashboard. `manager` already held branches.view from an
-- earlier grant; branches.orders.view and dashboard.view are new. The manager
-- role deliberately does NOT get create/update/delete: a real authorize() would
-- otherwise hand a manager the ability to delete every branch.
INSERT INTO role_has_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.slug IN ('branches.view', 'branches.orders.view', 'dashboard.view')
WHERE r.slug = 'manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Which roles the Branches module appears for. The first `module_has_roles`
-- block in seed.sql attaches every module to super_admin/admin, but it ran
-- before the `branches` module row existed, so it is repeated here for that one.
INSERT INTO module_has_roles (module_id, role_id)
SELECT m.id, r.id FROM modules m
JOIN roles r ON r.slug IN ('super_admin', 'admin', 'manager')
WHERE m.slug = 'branches'
ON CONFLICT (module_id, role_id) DO NOTHING;
