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