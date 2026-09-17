-- Earth धान्य seed data (idempotent)
-- Modules and default roles power module_has_roles / user_has_roles.

-- Modules
INSERT INTO modules (name, slug)
VALUES
  ('Users',    'users'),
  ('Dashboard','dashboard'),
  ('Products', 'products'),
  ('Orders',   'orders'),
  ('Email Templates', 'email_templates'),
  ('Settings', 'settings')
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
  ('Update Settings','settings.update','settings','Change panel theme, branding and preferences')
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
ON CONFLICT (role_id, permission_id) DO NOTHING;

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