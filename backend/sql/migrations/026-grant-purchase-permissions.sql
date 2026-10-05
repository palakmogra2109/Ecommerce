-- Grants the permissions introduced by migrations 023 and 024 to the roles that
-- need them.
--
-- Migrations 023 (supplies and purchases) and 024 (supplier bank details) created
-- permission rows but did not attach them to any role. Because super_admin
-- short-circuits in hasPermission and in the frontend's can(), the only account
-- that could see any of it was a super admin: every other role silently rendered
-- no bank icon, no "Add bank account" button, and no Purchases section at all.
--
-- The rows existed and were correct; nothing ever granted them. That is what made
-- it look like a broken button rather than a missing permission.
--
-- Granted to `admin` only. That role already holds all 80 pre-existing
-- permissions, so purchasing is consistent with it, and it is the right level for
-- a role that is deliberately below super_admin. Adjust in the Roles screen if
-- the business wants a different split -- this file just records the default.
--
-- Idempotent: ON CONFLICT DO NOTHING, and the role is looked up by slug rather
-- than by id, so it does not depend on seed order.

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
