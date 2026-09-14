// Single source of truth for app-wide constants.
// Import from @shared/constants in both backend and frontend.

// ---------- Roles ----------

export const ROLE_SLUGS = Object.freeze({
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
});

export const ROLE_NAMES = Object.freeze({
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
});

// Returns true when the given role row (with slug/name) or the
// given slug string refers to the super admin role.
export function isSuperAdmin(role) {
  if (typeof role === "string") {
    return (
      role === ROLE_SLUGS.SUPER_ADMIN ||
      role.toLowerCase() === ROLE_NAMES.SUPER_ADMIN.toLowerCase()
    );
  }

  if (!role) {
    return false;
  }

  return (
    role.slug === ROLE_SLUGS.SUPER_ADMIN ||
    role.name?.toLowerCase() === ROLE_NAMES.SUPER_ADMIN.toLowerCase()
  );
}

// ---------- Statuses ----------

// Single generic status. Reused by every feature that shares
// the ACTIVE / INACTIVE pair so they are never duplicated.
export const STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
});

export const STATUSES = Object.values(STATUS);

export const USER_STATUS = Object.freeze({
  ...STATUS,
  SUSPENDED: "SUSPENDED",
});

export const USER_STATUSES = Object.values(USER_STATUS);

export const ROLE_STATUS = STATUS;
export const ROLE_STATUSES = STATUSES;

export const MODULE_STATUS = STATUS;
export const MODULE_STATUSES = STATUSES;

// ---------- Permissions ----------

export const KEY_PERMISSIONS = Object.freeze({
  USERS_VIEW: "users.view",
  USERS_CREATE: "users.create",
  USERS_UPDATE: "users.update",
  USERS_DELETE: "users.delete",
  ROLES_VIEW: "roles.view",
  ROLES_CREATE: "roles.create",
  ROLES_UPDATE: "roles.update",
  ROLES_DELETE: "roles.delete",
  PERMISSIONS_VIEW: "permissions.view",
  PERMISSIONS_CREATE: "permissions.create",
  PERMISSIONS_UPDATE: "permissions.update",
  PERMISSIONS_DELETE: "permissions.delete",
  ROLES_ASSIGN_PERMISSIONS: "roles.assign_permissions",
});

// ---------- Email templates ----------

export const EMAIL_TEMPLATE_PERMISSIONS = Object.freeze({
  VIEW: "email_templates.view",
  CREATE: "email_templates.create",
  UPDATE: "email_templates.update",
  DELETE: "email_templates.delete",
});

// Slug of every seeded template. Mailers look up templates by slug.
export const EMAIL_TEMPLATE_SLUGS = Object.freeze({
  CREDENTIALS: "credentials",
  FORGOT_PASSWORD: "forgot_password",
  RESET_PASSWORD: "reset_password",
  WELCOME: "welcome",
});

// ---------- Settings ----------

export const SETTINGS_PERMISSIONS = Object.freeze({
  VIEW: "settings.view",
  UPDATE: "settings.update",
});

export const DEFAULT_THEME_COLOR = "#3b82f6";

// Theme colors offered as presets in the Settings page.
export const THEME_COLOR_PRESETS = Object.freeze([
  "#3b82f6", // Blue
  "#6366f1", // Indigo
  "#8b5cf6", // Violet
  "#a855f7", // Purple
  "#ec4899", // Pink
  "#f43f5e", // Rose
  "#ef4444", // Red
  "#f97316", // Orange
  "#f59e0b", // Amber
  "#22c55e", // Green
  "#14b8a6", // Teal
  "#0ea5e9", // Sky
]);

export const THEME_MODES = Object.freeze({
  LIGHT: "light",
  DARK: "dark",
});

// Picks a readable text color (#000000 or #ffffff) to place on top of
// the given theme color. White backgrounds always get black text and
// black backgrounds always get white text; every other color is judged
// by its relative luminance (dark text on light, white text on dark).
export function contrastText(hexColor) {
  const hex = String(hexColor || "").replace("#", "").toLowerCase();

  if (!/^[0-9a-f]{6}$/.test(hex)) {
    return "#ffffff";
  }

  if (hex === "ffffff") {
    return "#000000";
  }

  if (hex === "000000") {
    return "#ffffff";
  }

  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;

  const linear = (channel) =>
    channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);

  const luminance =
    0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

  return luminance > 0.55 ? "#000000" : "#ffffff";
}