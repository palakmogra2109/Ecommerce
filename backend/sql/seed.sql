-- E-Commerce seed data (idempotent)
-- Modules and default roles power module_has_roles / user_has_roles.

-- Modules
INSERT INTO modules (name, slug)
VALUES
  ('Users',    'users'),
  ('Dashboard','dashboard'),
  ('Products', 'products'),
  ('Orders',   'orders')
ON CONFLICT (slug) DO NOTHING;

-- Roles
INSERT INTO roles (name, slug, description)
VALUES
  ('Super Admin', 'super_admin', 'Full access to every module'),
  ('Admin',       'admin',       'Full access to managed modules'),
  ('Manager',     'manager',     'Manages day-to-day operations'),
  ('Staff',       'staff',       'Limited operational access')
ON CONFLICT (slug) DO NOTHING;

-- module_has_roles: which roles each module can use
INSERT INTO module_has_roles (module_id, role_id)
SELECT m.id, r.id
FROM (SELECT id, slug FROM modules) m
JOIN roles r ON r.slug IN ('super_admin', 'admin')
ON CONFLICT (module_id, role_id) DO NOTHING;

-- user_has_roles: assign a default role to every user
-- (existing users get 'staff' so they have at least one role)
INSERT INTO user_has_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.slug = 'staff'
WHERE u.id NOT IN (
  SELECT user_id FROM user_has_roles
)
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Permissions (sample)
INSERT INTO permissions (name, slug, module)
VALUES
  ('View Users',      'users.view',      'users'),
  ('Create Users',    'users.create',    'users'),
  ('Update Users',    'users.update',    'users'),
  ('Delete Users',    'users.delete',    'users'),
  ('View Roles',      'roles.view',      'roles'),
  ('Create Roles',    'roles.create',    'roles'),
  ('Update Roles',    'roles.update',    'roles'),
  ('Delete Roles',    'roles.delete',    'roles'),
  ('View Permissions','permissions.view','permissions'),
  ('Assign Permissions','roles.assign_permissions','roles')
ON CONFLICT (slug) DO NOTHING;

-- role_has_permissions: effective permissions per role
-- super_admin and admin get everything; manager and staff get a subset.
INSERT INTO role_has_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p
  ON (r.slug IN ('super_admin', 'admin'))
  OR (r.slug = 'manager' AND p.slug IN
     ('users.view', 'users.update', 'roles.view', 'permissions.view'))
  OR (r.slug = 'staff' AND p.slug IN
     ('roles.view', 'permissions.view'))
ON CONFLICT (role_id, permission_id) DO NOTHING;