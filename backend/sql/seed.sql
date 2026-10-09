-- Quick Kart seed data (idempotent)
-- Modules and default roles power module_has_roles / user_has_roles.

-- Modules
INSERT INTO modules (name, slug)
VALUES
  ('Users',    'users'),
  ('Roles',    'roles'),
  ('Permissions','permissions'),
  ('Dashboard','dashboard'),
  ('Categories','categories'),
  ('Brands',   'brands'),
  ('Attributes','attributes'),
  ('Products', 'products'),
  ('Customers','customers'),
  ('Orders',   'orders'),
  ('Coupons',  'coupons'),
  ('Reviews',  'reviews'),
  ('Banners',  'banners'),
  ('Email Templates', 'email_templates'),
  ('Settings', 'settings'),
  ('Store Dashboard', 'store_dashboard'),
  ('Store Products',   'store_products'),
  ('Store Orders',     'store_orders')
ON CONFLICT (slug) DO NOTHING;

-- Roles
INSERT INTO roles (name, slug, description)
VALUES
  ('Super Admin', 'super_admin', 'Full access to every module'),
  ('Admin',       'admin',       'Full access to managed modules'),
  ('Manager',     'manager',     'Manages day-to-day operations'),
  ('Staff',       'staff',       'Limited operational access'),
  ('Store',       'store',       'Store panel owner: manages a branch via the store panel')
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
INSERT INTO permissions (name, slug, module, description)
VALUES
  ('View Users',      'users.view',      'users', 'Browse the user directory and view user profiles'),
  ('Create Users',    'users.create',    'users', 'Create new user accounts and assign roles'),
  ('Update Users',    'users.update',    'users', 'Edit user details, status and access'),
  ('Delete Users',    'users.delete',    'users', 'Remove existing user accounts'),
  ('View Roles',      'roles.view',      'roles', 'Browse roles and their permission sets'),
  ('Create Roles',    'roles.create',    'roles', 'Create new roles'),
  ('Update Roles',    'roles.update',    'roles', 'Edit role details and status'),
  ('Delete Roles',    'roles.delete',    'roles', 'Remove roles that are no longer needed'),
  ('View Permissions','permissions.view','permissions','Browse the full list of permissions'),
  ('Assign Permissions','roles.assign_permissions','roles','Grant and revoke permissions on roles'),
  ('View Email Templates','email_templates.view','email_templates','Browse email templates and their content'),
  ('Create Email Templates','email_templates.create','email_templates','Create new transactional email templates'),
  ('Update Email Templates','email_templates.update','email_templates','Edit email template subjects and bodies'),
  ('Delete Email Templates','email_templates.delete','email_templates','Remove unused email templates'),
  ('View Settings','settings.view','settings','View panel settings and preferences'),
  ('Update Settings','settings.update','settings','Change panel theme, branding and preferences'),
  ('View Categories','categories.view','categories','Browse the category tree'),
  ('Create Categories','categories.create','categories','Create new categories'),
  ('Update Categories','categories.update','categories','Edit category details, image and SEO'),
  ('Delete Categories','categories.delete','categories','Delete categories'),
  ('View Brands','brands.view','brands','Browse brands'),
  ('Create Brands','brands.create','brands','Create new brands'),
  ('Update Brands','brands.update','brands','Edit brand details and logos'),
  ('Delete Brands','brands.delete','brands','Delete brands'),
  ('View Attributes','attributes.view','attributes','Browse product attributes'),
  ('Create Attributes','attributes.create','attributes','Create new attributes'),
  ('Update Attributes','attributes.update','attributes','Edit attributes'),
  ('Delete Attributes','attributes.delete','attributes','Delete attributes'),
  ('View Products','products.view','products','Browse the product catalogue'),
  ('Create Products','products.create','products','Create products, variants and pricing'),
  ('Update Products','products.update','products','Edit product details, stock and status'),
  ('Delete Products','products.delete','products','Delete products'),
  ('View Customers','customers.view','customers','Browse customers and their profiles'),
  ('Create Customers','customers.create','customers','Create customer accounts'),
  ('Update Customers','customers.update','customers','Edit customer details and status'),
  ('Delete Customers','customers.delete','customers','Delete customers'),
  ('View Orders','orders.view','orders','Browse orders and order details'),
  ('Update Orders','orders.update','orders','Change order status and payment state'),
  ('Cancel Orders','orders.cancel','orders','Cancel pending or confirmed orders'),
  ('Delete Orders','orders.delete','orders','Delete orders'),
  ('View Coupons','coupons.view','coupons','Browse coupons'),
  ('Create Coupons','coupons.create','coupons','Create coupons'),
  ('Update Coupons','coupons.update','coupons','Edit coupon rules'),
  ('Delete Coupons','coupons.delete','coupons','Delete coupons'),
  ('View Reviews','reviews.view','reviews','Browse product reviews'),
  ('Moderate Reviews','reviews.moderate','reviews','Approve and reject reviews'),
  ('Delete Reviews','reviews.delete','reviews','Delete reviews'),
  ('View Banners','banners.view','banners','Browse banners'),
  ('Create Banners','banners.create','banners','Create banners'),
  ('Update Banners','banners.update','banners','Edit banners'),
  ('Delete Banners','banners.delete','banners','Delete banners')
ON CONFLICT (slug) DO NOTHING;

-- Backfill descriptions on existing databases (idempotent)
UPDATE permissions SET description = CASE slug
  WHEN 'users.view'                THEN 'Browse the user directory and view user profiles'
  WHEN 'users.create'              THEN 'Create new user accounts and assign roles'
  WHEN 'users.update'              THEN 'Edit user details, status and access'
  WHEN 'users.delete'              THEN 'Remove existing user accounts'
  WHEN 'roles.view'                THEN 'Browse roles and their permission sets'
  WHEN 'roles.create'              THEN 'Create new roles'
  WHEN 'roles.update'              THEN 'Edit role details and status'
  WHEN 'roles.delete'              THEN 'Remove roles that are no longer needed'
  WHEN 'permissions.view'          THEN 'Browse the full list of permissions'
  WHEN 'roles.assign_permissions'  THEN 'Grant and revoke permissions on roles'
  WHEN 'email_templates.view'      THEN 'Browse email templates and their content'
  WHEN 'email_templates.create'    THEN 'Create new transactional email templates'
  WHEN 'email_templates.update'    THEN 'Edit email template subjects and bodies'
  WHEN 'email_templates.delete'    THEN 'Remove unused email templates'
  WHEN 'settings.view'             THEN 'View panel settings and preferences'
  WHEN 'settings.update'           THEN 'Change panel theme, branding and preferences'
END
WHERE description = ''
  AND slug IN (
    'users.view','users.create','users.update','users.delete',
    'roles.view','roles.create','roles.update','roles.delete',
    'permissions.view','roles.assign_permissions',
    'email_templates.view','email_templates.create','email_templates.update','email_templates.delete',
    'settings.view','settings.update'
  );

-- Backfill role descriptions on existing databases (idempotent)
UPDATE roles SET description = CASE slug
  WHEN 'super_admin' THEN 'Full access to every module'
  WHEN 'admin'       THEN 'Full access to managed modules'
  WHEN 'manager'     THEN 'Manages day-to-day operations'
  WHEN 'staff'       THEN 'Limited operational access'
END
WHERE description = ''
  AND slug IN ('super_admin', 'admin', 'manager', 'staff');

-- Store permissions (used by the store panel and the store sidebar
-- entries). Kept idempotent for fresh and existing databases.
INSERT INTO permissions (name, slug, module, description)
VALUES
  ('View Store Dashboard', 'store_dashboard.view', 'store_dashboard', 'View store statistics and overview'),
  ('View Store Products',  'store_products.view',  'store_products',  'View store product pricing and stock'),
  ('Update Store Products','store_products.update','store_products',  'Update store product pricing and stock'),
  ('View Store Orders',    'store_orders.view',    'store_orders',    'View store orders'),
  ('Update Store Orders',  'store_orders.update',  'store_orders',    'Update store order status')
ON CONFLICT (slug) DO NOTHING;

-- role_has_permissions: effective permissions per role
-- super_admin and admin get everything; manager gets a subset;
-- staff currently has a single permission (users.view) so the
-- sidebar shows just the Users module for regular accounts.
INSERT INTO role_has_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p
  ON (r.slug IN ('super_admin', 'admin'))
  OR (r.slug = 'manager' AND p.slug IN
     ('users.view', 'users.update', 'roles.view', 'permissions.view'))
  OR (r.slug = 'staff' AND p.slug = 'users.view')
  OR (r.slug = 'store' AND p.slug IN
     ('store_dashboard.view', 'store_products.view', 'store_products.update',
      'store_orders.view', 'store_orders.update'))
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Link the store modules to the roles that can manage them.
INSERT INTO module_has_roles (module_id, role_id)
SELECT m.id, r.id
FROM modules m
JOIN roles r ON r.slug IN ('store', 'super_admin', 'admin')
WHERE m.slug IN ('store_dashboard', 'store_products', 'store_orders')
ON CONFLICT (module_id, role_id) DO NOTHING;

-- Backfill role descriptions on existing databases (idempotent)
UPDATE roles SET description = CASE slug
  WHEN 'super_admin' THEN 'Full access to every module'
  WHEN 'admin'       THEN 'Full access to managed modules'
  WHEN 'manager'     THEN 'Manages day-to-day operations'
  WHEN 'staff'       THEN 'Limited operational access'
  WHEN 'store'       THEN 'Store panel owner: manages a branch via the store panel'
END
WHERE description = ''
  AND slug IN ('super_admin', 'admin', 'manager', 'staff', 'store');

-- Migrate existing store accounts (any user linked to a branch) to the
-- store role so every branch user maps to the "Store" role going forward.
INSERT INTO user_has_roles (user_id, role_id)
SELECT DISTINCT bu.userid, r.id
FROM branch_users bu
CROSS JOIN roles r
WHERE r.slug = 'store'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- =============================================================
-- email_templates
-- Multiple default templates. Content is editable from the admin
-- panel; only the {{placeholders}} are filled dynamically.
-- Only dynamic values that a mailer passes can be used here.
-- =============================================================

-- 1. Login credentials (sent when an admin creates a user)
INSERT INTO email_templates (name, slug, subject, body_html, body_text, variables)
VALUES (
  'Login Credentials',
  'credentials',
  'Your {{appName}} Account Credentials',
  $html$
<div style="background:#f1f5f9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
    <div style="background:{{themePrimary}};padding:32px 40px;">
      <div style="color:{{themeOnPrimary}};font-size:24px;font-weight:bold;">{{appName}}</div>
      <div style="color:{{themeOnPrimary}};font-size:13px;margin-top:4px;">Account credentials</div>
    </div>
    <div style="padding:40px;">
      <p style="margin:0 0 8px;font-size:16px;color:#0f172a;">Hi {{userName}},</p>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#334155;">
        Your administrator account has been created. Please use the credentials below to sign in to your panel.
      </p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin-bottom:6px;">Email</div>
        <div style="font-size:15px;font-weight:bold;color:#0f172a;margin-bottom:16px;">{{email}}</div>
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin-bottom:6px;">Password</div>
        <div style="font-size:15px;font-weight:bold;color:#0f172a;">{{password}}</div>
      </div>
      <p style="margin:0 0 8px;font-size:14px;color:#334155;">Sign in here:</p>
      <a href="{{loginUrl}}" style="display:inline-block;background:{{themePrimary}};color:{{themeOnPrimary}};text-decoration:none;padding:12px 28px;border-radius:6px;font-size:14px;font-weight:bold;margin-bottom:24px;">Log in to your account</a>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">
        For your security, please log in and change your password as soon as possible. Never share these credentials with anyone.
      </p>
    </div>
    <div style="padding:24px 40px;background:#f8fafc;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
        This is an automated message from {{appName}}. Do not reply to this email.<br />
        If you did not request this account, please contact your administrator.
      </p>
    </div>
  </div>
</div>
  $html$,
  $html$
Hi {{userName}},

Your administrator account has been created. Please use the credentials below to sign in to your panel.

Email:     {{email}}
Password:  {{password}}

Sign in here: {{loginUrl}}

For your security, please log in and change your password as soon as possible. Never share these credentials with anyone.

This is an automated message from {{appName}}. Do not reply to this email.
  $html$,
  '["appName","userName","email","password","loginUrl","themePrimary","themeOnPrimary"]'
)
ON CONFLICT (slug) DO NOTHING;

-- 2. Forgot password (request a password reset link)
INSERT INTO email_templates (name, slug, subject, body_html, body_text, variables)
VALUES (
  'Forgot Password',
  'forgot_password',
  'Reset your {{appName}} password',
  $html$
<div style="background:#f1f5f9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
    <div style="background:{{themePrimary}};padding:32px 40px;">
      <div style="color:{{themeOnPrimary}};font-size:24px;font-weight:bold;">{{appName}}</div>
      <div style="color:{{themeOnPrimary}};font-size:13px;margin-top:4px;">Reset your password</div>
    </div>
    <div style="padding:40px;">
      <p style="margin:0 0 8px;font-size:16px;color:#0f172a;">Hi {{userName}},</p>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#334155;">
        We received a request to reset your password. Click the button below to choose a new one. This link expires shortly.
      </p>
      <a href="{{resetLink}}" style="display:inline-block;background:{{themePrimary}};color:{{themeOnPrimary}};text-decoration:none;padding:12px 28px;border-radius:6px;font-size:14px;font-weight:bold;margin-bottom:24px;">Reset password</a>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">
        If you did not request this, you can safely ignore this email. Your password will not change.
      </p>
    </div>
    <div style="padding:24px 40px;background:#f8fafc;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
        This is an automated message from {{appName}}. Do not reply to this email.
      </p>
    </div>
  </div>
</div>
  $html$,
  $html$
Hi {{userName}},

We received a request to reset your password. Open the link below to choose a new one:

{{resetLink}}

If you did not request this, you can safely ignore this email. Your password will not change.

This is an automated message from {{appName}}.
  $html$,
  '["appName","userName","resetLink","themePrimary","themeOnPrimary"]'
)
ON CONFLICT (slug) DO NOTHING;

-- 3. Password reset confirmation
INSERT INTO email_templates (name, slug, subject, body_html, body_text, variables)
VALUES (
  'Password Reset Confirmation',
  'reset_password',
  'Your {{appName}} password has been changed',
  $html$
<div style="background:#f1f5f9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
    <div style="background:{{themePrimary}};padding:32px 40px;">
      <div style="color:{{themeOnPrimary}};font-size:24px;font-weight:bold;">{{appName}}</div>
      <div style="color:{{themeOnPrimary}};font-size:13px;margin-top:4px;">Password changed</div>
    </div>
    <div style="padding:40px;">
      <p style="margin:0 0 8px;font-size:16px;color:#0f172a;">Hi {{userName}},</p>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#334155;">
        This is a confirmation that your {{appName}} password was changed successfully.
      </p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">
        If you did not make this change, please contact your administrator immediately.
      </p>
    </div>
    <div style="padding:24px 40px;background:#f8fafc;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
        This is an automated message from {{appName}}. Do not reply to this email.
      </p>
    </div>
  </div>
</div>
  $html$,
  $html$
Hi {{userName}},

This is a confirmation that your {{appName}} password was changed successfully.

If you did not make this change, please contact your administrator immediately.

This is an automated message from {{appName}}.
  $html$,
  '["appName","userName","themePrimary","themeOnPrimary"]'
)
ON CONFLICT (slug) DO NOTHING;

-- 4. Welcome (optional onboarding email)
INSERT INTO email_templates (name, slug, subject, body_html, body_text, variables)
VALUES (
  'Welcome Email',
  'welcome',
  'Welcome to {{appName}}, {{userName}}!',
  $html$
<div style="background:#f1f5f9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
    <div style="background:{{themePrimary}};padding:32px 40px;">
      <div style="color:{{themeOnPrimary}};font-size:24px;font-weight:bold;">{{appName}}</div>
      <div style="color:{{themeOnPrimary}};font-size:13px;margin-top:4px;">Welcome aboard</div>
    </div>
    <div style="padding:40px;">
      <p style="margin:0 0 8px;font-size:16px;color:#0f172a;">Hi {{userName}},</p>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#334155;">
        Welcome to {{appName}}! Your account with {{email}} is ready. Sign in to get started.
      </p>
      <a href="{{loginUrl}}" style="display:inline-block;background:{{themePrimary}};color:{{themeOnPrimary}};text-decoration:none;padding:12px 28px;border-radius:6px;font-size:14px;font-weight:bold;margin-bottom:24px;">Go to {{appName}}</a>
    </div>
    <div style="padding:24px 40px;background:#f8fafc;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
        This is an automated message from {{appName}}. Do not reply to this email.
      </p>
    </div>
  </div>
</div>
  $html$,
  $html$
Hi {{userName}},

Welcome to {{appName}}! Your account with {{email}} is ready. Sign in to get started: {{loginUrl}}

This is an automated message from {{appName}}.
  $html$,
  '["appName","userName","email","loginUrl","themePrimary","themeOnPrimary"]'
)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================
-- Sample catalogue data (idempotent)
-- =============================================================

-- Categories (nested tree)
INSERT INTO categories (name, slug, description, status, sort_order)
VALUES
  ('Groceries', 'groceries', 'Everyday grocery essentials', 'ACTIVE', 1),
  ('Grains & Pulses', 'grains-pulses', 'Rice, wheat, daal and other staples', 'ACTIVE', 1),
  ('Oils & Ghee', 'oils-ghee', 'Cooking oils and pure ghee', 'ACTIVE', 2),
  ('Spices & Masalas', 'spices-masalas', 'Whole and ground spices', 'ACTIVE', 3),
  ('Personal Care', 'personal-care', 'Bath, body and hair care', 'ACTIVE', 4),
  ('Household', 'household', 'Cleaning and home essentials', 'ACTIVE', 5)
ON CONFLICT (slug) DO NOTHING;

-- Nest grocery children under Groceries (requires the id lookup)
UPDATE categories SET parent_id = (SELECT id FROM categories WHERE slug = 'groceries')
WHERE slug IN ('grains-pulses', 'oils-ghee', 'spices-masalas')
  AND parent_id IS NULL;

-- Brands
INSERT INTO brands (name, slug, description, status)
VALUES
  ('Aditi Mills', 'aditi-mills', 'Family-run mill supplying fresh grains', 'ACTIVE'),
  ('Earth Harvest', 'earth-harvest', 'Organic and sustainably grown produce', 'ACTIVE'),
  ('Nila Organics', 'nila-organics', 'Certified organic pantry staples', 'ACTIVE'),
  ('TerraFields', 'terrafields', 'Premium staples at honest prices', 'ACTIVE')
ON CONFLICT (slug) DO NOTHING;

-- Attributes
INSERT INTO attributes (name, slug, status)
VALUES
  ('Weight', 'weight', 'ACTIVE'),
  ('Pack Size', 'pack-size', 'ACTIVE'),
  ('Colour', 'colour', 'ACTIVE'),
  ('Size', 'size', 'ACTIVE')
ON CONFLICT (slug) DO NOTHING;

-- Products
INSERT INTO products
  (name, slug, sku, short_description, description, price, discount_price,
   stock, low_stock_threshold, brand_id, category_id, images, attributes,
   variants, meta_title, meta_description, featured, status)
VALUES
  (
    'Basmati Rice 5kg', 'basmati-rice-5kg', 'BAS-RIC-5000',
    'Long-grain premium basmati rice, aged for a richer aroma.',
    'Premium aged basmati rice grown in the foothills of the Himalayas. Each grain stays separate and fluffy after cooking, perfect for biryani and everyday meals.',
    899.00, 799.00, 120, 15,
    (SELECT id FROM brands WHERE slug = 'aditi-mills'),
    (SELECT id FROM categories WHERE slug = 'grains-pulses'),
    '[]',
    (SELECT jsonb_build_array(jsonb_build_object('attribute_uuid', a.uuid, 'name', a.name, 'value', '5kg')) FROM attributes a WHERE a.slug = 'weight'),
    (SELECT jsonb_build_array(
       jsonb_build_object('name', '5kg', 'sku', 'BAS-RIC-5000', 'price', 799.00, 'stock', 120),
       jsonb_build_object('name', '25kg', 'sku', 'BAS-RIC-25000', 'price', 3699.00, 'stock', 40)
     )),
    'Basmati Rice 5kg', 'Premium aged basmati rice, 5kg pack. Buy online at the best price.', TRUE, 'ACTIVE'
  ),
  (
    'Toor Dal 1kg', 'toor-dal-1kg', 'TOO-DAL-1000',
    'Clean, sorted toor dal with no artificial polishing.',
    'Unpolished toor dal (arhar) cleaned and sorted in small batches. Cooks quickly and turns the perfect creamy yellow.',
    189.00, 169.00, 200, 20,
    (SELECT id FROM brands WHERE slug = 'nila-organics'),
    (SELECT id FROM categories WHERE slug = 'grains-pulses'),
    '[]',
    (SELECT jsonb_build_array(jsonb_build_object('attribute_uuid', a.uuid, 'name', a.name, 'value', '1kg')) FROM attributes a WHERE a.slug = 'weight'),
    '[]', 'Toor Dal 1kg', 'Unpolished toor dal, 1kg. Fresh and chemical-free.', TRUE, 'ACTIVE'
  ),
  (
    'Cold Pressed Groundnut Oil 1L', 'groundnut-oil-1l', 'OIL-GNT-1000',
    'Wood-pressed groundnut oil, cold extracted.',
    'Traditional wood-pressed groundnut oil with a rich nutty aroma. No chemicals, no refining – just pure cold pressed goodness.',
    349.00, NULL, 75, 10,
    (SELECT id FROM brands WHERE slug = 'earth-harvest'),
    (SELECT id FROM categories WHERE slug = 'oils-ghee'),
    '[]',
    (SELECT jsonb_build_array(jsonb_build_object('attribute_uuid', a.uuid, 'name', a.name, 'value', '1L')) FROM attributes a WHERE a.slug = 'weight'),
    '[]', 'Groundnut Oil 1L', 'Cold pressed groundnut oil, 1 litre bottle.', FALSE, 'ACTIVE'
  ),
  (
    'Organic Turmeric Powder 200g', 'organic-turmeric-powder-200g', 'TUR-POW-0200',
    'Single-origin organic turmeric with high curcumin content.',
    'Single-origin organic turmeric powder, sun-dried and ground stone-cold to lock in colour and curcumin.',
    149.00, NULL, 90, 10,
    (SELECT id FROM brands WHERE slug = 'nila-organics'),
    (SELECT id FROM categories WHERE slug = 'spices-masalas'),
    '[]',
    (SELECT jsonb_build_array(jsonb_build_object('attribute_uuid', a.uuid, 'name', a.name, 'value', '200g')) FROM attributes a WHERE a.slug = 'weight'),
    '[]', 'Organic Turmeric Powder 200g', '100% organic turmeric powder, 200g pack.', FALSE, 'ACTIVE'
  ),
  (
    'Cotton T-Shirt', 'cotton-t-shirt', 'TSHIRT-CTN-001',
    'Soft everyday cotton t-shirt in multiple colours.',
    'Comfortable 100% combed cotton t-shirt. Breathable fabric that stays soft wash after wash.',
    499.00, 399.00, 60, 8,
    (SELECT id FROM brands WHERE slug = 'terrafields'),
    (SELECT id FROM categories WHERE slug = 'household'),
    '[]',
    (SELECT jsonb_build_array(
       jsonb_build_object('attribute_uuid', a.uuid, 'name', a.name, 'value', 'Black'),
       jsonb_build_object('attribute_uuid', s.uuid, 'name', s.name, 'value', 'M')
     ) FROM attributes a CROSS JOIN attributes s
     WHERE a.slug = 'colour' AND s.slug = 'size'),
    '[]', 'Cotton T-Shirt', 'Premium cotton t-shirt for everyday wear.', FALSE, 'DRAFT'
  )
ON CONFLICT (slug) DO NOTHING;

-- Customers
INSERT INTO customers (name, email, mobile, address, status)
VALUES
  ('Asha Nair', 'asha.nair@example.com', '+919876543210', '{"line1":"14 MG Road","city":"Bengaluru","state":"Karnataka","postal":"560001","country":"India"}', 'ACTIVE'),
  ('Rohit Sharma', 'rohit.sharma@example.com', '+919812345670', '{"line1":"22 Janpath","city":"New Delhi","state":"Delhi","postal":"110001","country":"India"}', 'ACTIVE'),
  ('Priya Patel', 'priya.patel@example.com', '+919900112233', '{"line1":"8 CG Road","city":"Ahmedabad","state":"Gujarat","postal":"380009","country":"India"}', 'ACTIVE'),
  ('Karan Mehta', 'karan.mehta@example.com', '+919823456789', '{"line1":"55 Linking Road","city":"Mumbai","state":"Maharashtra","postal":"400052","country":"India"}', 'SUSPENDED')
ON CONFLICT (email) DO NOTHING;

-- Coupons
INSERT INTO coupons (code, type, value, min_order_amount, max_discount_amount, starts_at, ends_at, usage_limit, per_customer_limit, description, status)
VALUES
  ('WELCOME10', 'PERCENTAGE', 10, 499, 200, now() - interval '30 days', now() + interval '90 days', 500, 1, '10% off your first order. Max discount ₹200.', 'ACTIVE'),
  ('SAVE200', 'FIXED', 200, 999, NULL, now() - interval '10 days', now() + interval '30 days', 200, 2, 'Flat ₹200 off orders above ₹999.', 'ACTIVE')
ON CONFLICT (code) DO NOTHING;

-- Orders
INSERT INTO orders
  (order_number, customer_id, customer_name, customer_email, customer_mobile,
   shipping_address, subtotal, discount, total, coupon_id, coupon_code,
   payment_method, payment_status, status)
VALUES
  ('ORD-1001', (SELECT id FROM customers WHERE email = 'asha.nair@example.com'), 'Asha Nair', 'asha.nair@example.com', '+919876543210',
   '{"line1":"14 MG Road","city":"Bengaluru","state":"Karnataka","postal":"560001","country":"India"}',
   799.00, 0, 799.00, NULL, NULL, 'upi', 'PAID', 'DELIVERED'),
  ('ORD-1002', (SELECT id FROM customers WHERE email = 'rohit.sharma@example.com'), 'Rohit Sharma', 'rohit.sharma@example.com', '+919812345670',
   '{"line1":"22 Janpath","city":"New Delhi","state":"Delhi","postal":"110001","country":"India"}',
   898.00, 89.80, 808.20, (SELECT id FROM coupons WHERE code = 'WELCOME10'), 'WELCOME10',
   'card', 'PAID', 'SHIPPED'),
  ('ORD-1003', (SELECT id FROM customers WHERE email = 'priya.patel@example.com'), 'Priya Patel', 'priya.patel@example.com', '+919900112233',
   '{"line1":"8 CG Road","city":"Ahmedabad","state":"Gujarat","postal":"380009","country":"India"}',
   349.00, 0, 349.00, NULL, NULL, 'cod', 'PENDING', 'PENDING'),
  ('ORD-1004', (SELECT id FROM customers WHERE email = 'asha.nair@example.com'), 'Asha Nair', 'asha.nair@example.com', '+919876543210',
   '{"line1":"14 MG Road","city":"Bengaluru","state":"Karnataka","postal":"560001","country":"India"}',
   898.00, 89.80, 808.20, (SELECT id FROM coupons WHERE code = 'WELCOME10'), 'WELCOME10',
   'upi', 'PAID', 'CANCELLED')
ON CONFLICT (order_number) DO NOTHING;

-- Order items
INSERT INTO order_items (order_id, product_id, product_uuid, product_name, sku, variant, price, quantity, subtotal)
SELECT o.id, p.id, p.uuid, p.name, p.sku, '5kg', 799.00, 1, 799.00
FROM orders o, products p
WHERE o.order_number = 'ORD-1001' AND p.slug = 'basmati-rice-5kg'
ON CONFLICT DO NOTHING;

INSERT INTO order_items (order_id, product_id, product_uuid, product_name, sku, variant, price, quantity, subtotal)
SELECT o.id, p.id, p.uuid, p.name, p.sku, NULL, 169.00, 2, 338.00
FROM orders o, products p
WHERE o.order_number = 'ORD-1002' AND p.slug = 'toor-dal-1kg'
ON CONFLICT DO NOTHING;

INSERT INTO order_items (order_id, product_id, product_uuid, product_name, sku, variant, price, quantity, subtotal)
SELECT o.id, p.id, p.uuid, p.name, p.sku, NULL, 349.00, 1, 349.00
FROM orders o, products p
WHERE o.order_number = 'ORD-1002' AND p.slug = 'groundnut-oil-1l'
ON CONFLICT DO NOTHING;

INSERT INTO order_items (order_id, product_id, product_uuid, product_name, sku, variant, price, quantity, subtotal)
SELECT o.id, p.id, p.uuid, p.name, p.sku, NULL, 349.00, 1, 349.00
FROM orders o, products p
WHERE o.order_number = 'ORD-1003' AND p.slug = 'groundnut-oil-1l'
ON CONFLICT DO NOTHING;

INSERT INTO order_items (order_id, product_id, product_uuid, product_name, sku, variant, price, quantity, subtotal)
SELECT o.id, p.id, p.uuid, p.name, p.sku, NULL, 169.00, 2, 338.00
FROM orders o, products p
WHERE o.order_number = 'ORD-1004' AND p.slug = 'toor-dal-1kg'
ON CONFLICT DO NOTHING;

INSERT INTO order_items (order_id, product_id, product_uuid, product_name, sku, variant, price, quantity, subtotal)
SELECT o.id, p.id, p.uuid, p.name, p.sku, NULL, 149.00, 2, 298.00
FROM orders o, products p
WHERE o.order_number = 'ORD-1004' AND p.slug = 'organic-turmeric-powder-200g'
ON CONFLICT DO NOTHING;

-- Reviews
INSERT INTO reviews (product_id, customer_id, customer_name, rating, title, comment, status, admin_response)
VALUES
  ((SELECT id FROM products WHERE slug = 'basmati-rice-5kg'), (SELECT id FROM customers WHERE email = 'asha.nair@example.com'), 'Asha Nair', 5, 'Excellent aroma',
   'The rice smells amazing and each grain stays separate after cooking. Best basmati I have bought online.',
   'APPROVED', 'Thank you for the lovely feedback, Asha!'),
  ((SELECT id FROM products WHERE slug = 'toor-dal-1kg'), (SELECT id FROM customers WHERE email = 'rohit.sharma@example.com'), 'Rohit Sharma', 4, 'Good quality dal',
   'Clean dal with very few stones. Cooks nicely. Slightly more expensive than the market but worth it.',
   'APPROVED', NULL),
  ((SELECT id FROM products WHERE slug = 'groundnut-oil-1l'), (SELECT id FROM customers WHERE email = 'priya.patel@example.com'), 'Priya Patel', 5, 'Authentic wood pressed',
   'You can smell the difference. Great for tadka. Will order again.',
   'PENDING', NULL),
  ((SELECT id FROM products WHERE slug = 'organic-turmeric-powder-200g'), (SELECT id FROM customers WHERE email = 'karan.mehta@example.com'), 'Karan Mehta', 2, 'Average',
   'Colour seems lighter than expected, not sure about freshness.',
   'PENDING', NULL)
ON CONFLICT DO NOTHING;

-- Banners
INSERT INTO banners (title, subtitle, image, link, position, sort_order, status)
VALUES
  ('Fresh from the farm', 'Daily essentials delivered to your door', NULL, '/products', 'hero', 1, 'ACTIVE'),
  ('Monsoon Sale – Up to 20% off', 'On everyday groceries', NULL, '/products', 'promo', 1, 'ACTIVE'),
  ('Organic Picks', 'Certified organic staples, straight to your kitchen', NULL, '/categories/organic-picks', 'promo', 2, 'INACTIVE')
ON CONFLICT DO NOTHING;