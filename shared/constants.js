// Single source of truth for app-wide constants.
// Import from @shared/constants in both backend and frontend.

// ---------- Roles ----------

export const ROLE_SLUGS = Object.freeze({
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  BRANCH_MANAGER: "branch_manager",
  STORE: "store",
});

export const ROLE_NAMES = Object.freeze({
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  BRANCH_MANAGER: "Branch Manager",
  STORE: "Store",
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

// Returns true when the given role row (with slug/name) or the given
// slug string refers to the store role (managed via Branches, not Users).
export function isStoreRole(role) {
  if (typeof role === "string") {
    return (
      role === ROLE_SLUGS.STORE ||
      role.toLowerCase() === ROLE_NAMES.STORE.toLowerCase()
    );
  }

  if (!role) {
    return false;
  }

  return (
    role.slug === ROLE_SLUGS.STORE ||
    role.name?.toLowerCase() === ROLE_NAMES.STORE.toLowerCase()
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
  CATEGORIES_VIEW: "categories.view",
  CATEGORIES_CREATE: "categories.create",
  CATEGORIES_UPDATE: "categories.update",
  CATEGORIES_DELETE: "categories.delete",
  BRANDS_VIEW: "brands.view",
  BRANDS_CREATE: "brands.create",
  BRANDS_UPDATE: "brands.update",
  BRANDS_DELETE: "brands.delete",
  ATTRIBUTES_VIEW: "attributes.view",
  ATTRIBUTES_CREATE: "attributes.create",
  ATTRIBUTES_UPDATE: "attributes.update",
  ATTRIBUTES_DELETE: "attributes.delete",
  PRODUCTS_VIEW: "products.view",
  PRODUCTS_CREATE: "products.create",
  PRODUCTS_UPDATE: "products.update",
  PRODUCTS_DELETE: "products.delete",
  CUSTOMERS_VIEW: "customers.view",
  CUSTOMERS_CREATE: "customers.create",
  CUSTOMERS_UPDATE: "customers.update",
  CUSTOMERS_DELETE: "customers.delete",
  ORDERS_VIEW: "orders.view",
  ORDERS_UPDATE: "orders.update",
  ORDERS_CANCEL: "orders.cancel",
  ORDERS_DELETE: "orders.delete",
  COUPONS_VIEW: "coupons.view",
  COUPONS_CREATE: "coupons.create",
  COUPONS_UPDATE: "coupons.update",
  COUPONS_DELETE: "coupons.delete",
  GIFT_CARDS_VIEW: "gift_cards.view",
  GIFT_CARDS_CREATE: "gift_cards.create",
  GIFT_CARDS_UPDATE: "gift_cards.update",
  GIFT_CARDS_DELETE: "gift_cards.delete",
  REVIEWS_VIEW: "reviews.view",
  REVIEWS_MODERATE: "reviews.moderate",
  REVIEWS_DELETE: "reviews.delete",
  BANNERS_VIEW: "banners.view",
  BANNERS_CREATE: "banners.create",
  BANNERS_UPDATE: "banners.update",
  BANNERS_DELETE: "banners.delete",
  BRANCHES_VIEW: "branches.view",
  BRANCHES_CREATE: "branches.create",
  BRANCHES_UPDATE: "branches.update",
  BRANCHES_DELETE: "branches.delete",
  BRANCH_INVENTORY_VIEW: "branches.inventory.view",
  BRANCH_INVENTORY_UPDATE: "branches.inventory.update",
  BRANCH_ORDERS_VIEW: "branches.orders.view",
  BRANCH_ORDERS_UPDATE: "branches.orders.update",
  BRANCH_PRICE_VIEW: "branches.price.view",
  BRANCH_PRICE_UPDATE: "branches.price.update",
  // The STORE_* slugs use underscores, not dots: that is how `permissions.slug`
  // spells them in the database, and a dotted slug matches no permission row, so
  // authorize() would deny it to everyone. Every other family above is dotted
  // because that is what its rows are.
  STORE_DASHBOARD_VIEW: "store_dashboard.view",
  STORE_PRODUCTS_VIEW: "store_products.view",
  STORE_PRODUCTS_UPDATE: "store_products.update",
  STORE_ORDERS_VIEW: "store_orders.view",
  STORE_ORDERS_UPDATE: "store_orders.update",
  DASHBOARD_VIEW: "dashboard.view",
  // Purchases. Dotted slugs, matching the rows seeded in sql/migrations/023.
  // The key names are underscored but the slug values are dotted, exactly as
  // for the families above.
  SUPPLIERS_VIEW: "suppliers.view",
  SUPPLIERS_CREATE: "suppliers.create",
  SUPPLIERS_UPDATE: "suppliers.update",
  SUPPLIERS_DELETE: "suppliers.delete",
  // Bank details have their own grants: account numbers are a secret, and
  // reading one is not the same permission as editing a supplier name.
  SUPPLIERS_BANK_VIEW: "suppliers.bank.view",
  SUPPLIERS_BANK_MANAGE: "suppliers.bank.manage",
  PURCHASE_INVOICES_VIEW: "purchase_invoices.view",
  PURCHASE_INVOICES_CREATE: "purchase_invoices.create",
  PURCHASE_INVOICES_UPDATE: "purchase_invoices.update",
  PURCHASE_INVOICES_CANCEL: "purchase_invoices.cancel",
  // Receiving stock and paying a supplier are separate from authoring the
  // invoice: the person who books what was ordered is often not the person
  // who counts what arrived, and the bill payer is neither.
  PURCHASE_INVOICES_RECEIVE: "purchase_invoices.receive",
  PURCHASE_INVOICES_PAY: "purchase_invoices.pay",
});

// ---------- Modules ----------

// Human-friendly module metadata used by the permission picker and
// filter dropdowns across both the backend API and the admin panel.
export const MODULES = Object.freeze({
  USERS: { slug: "users", label: "Users", description: "Manage users, their accounts and access." },
  ROLES: { slug: "roles", label: "Roles", description: "Manage roles and their permission sets." },
  PERMISSIONS: { slug: "permissions", label: "Permissions", description: "Manage permissions across modules." },
  DASHBOARD: { slug: "dashboard", label: "Dashboard", description: "View analytics and panel overview." },
  CATEGORIES: { slug: "categories", label: "Categories", description: "Organise products into a nested category tree." },
  BRANDS: { slug: "brands", label: "Brands", description: "Manage product brands." },
  ATTRIBUTES: { slug: "attributes", label: "Attributes", description: "Manage product attributes such as colour and size." },
  PRODUCTS: { slug: "products", label: "Products", description: "Manage the product catalogue and inventory." },
  CUSTOMERS: { slug: "customers", label: "Customers", description: "Manage customer accounts and order history." },
  ORDERS: { slug: "orders", label: "Orders", description: "Manage orders, payments and fulfilment." },
  COUPONS: { slug: "coupons", label: "Coupons", description: "Create discounts and run promotions." },
  REVIEWS: { slug: "reviews", label: "Reviews", description: "Moderate customer product reviews." },
  BANNERS: { slug: "banners", label: "Banners", description: "Manage promotional banners and offers." },
  EMAIL_TEMPLATES: { slug: "email_templates", label: "Email Templates", description: "Manage email templates for transactional messages." },
  SETTINGS: { slug: "settings", label: "Settings", description: "Manage panel settings and site preferences." },
  BRANCHES: { slug: "branches", label: "Branches", description: "Manage branches, inventory, orders, and pricing." },
  STORE_DASHBOARD: { slug: "store_dashboard", label: "Store Dashboard", description: "View store statistics and overview." },
  STORE_PRODUCTS: { slug: "store_products", label: "Store Products", description: "Manage store product pricing and stock." },
  STORE_ORDERS: { slug: "store_orders", label: "Store Orders", description: "Manage store orders from accept to delivered." },
});

export const MODULE_LABELS = Object.freeze(
  Object.fromEntries(
    Object.values(MODULES).map((m) => [m.slug, m.label])
  )
);

export const MODULE_DESCRIPTIONS = Object.freeze(
  Object.fromEntries(
    Object.values(MODULES).map((m) => [m.slug, m.description])
  )
);

// Module slugs ordered for the permission picker / filter UI.
export const MODULE_SLUGS = Object.freeze(
  Object.values(MODULES).map((m) => m.slug)
);

// ---------- Permission type helpers ----------
// Classifies the create/update/delete/view suffix of a slug so the
// picker can render a colour-coded badge per action.
export const PERMISSION_TYPE_INFO = Object.freeze({
  view: { label: "View", color: "#10b981" },   // emerald
  create: { label: "Create", color: "#3b82f6" }, // blue
  update: { label: "Update", color: "#f59e0b" }, // amber
  delete: { label: "Delete", color: "#ef4444" }, // red
  assign: { label: "Assign", color: "#8b5cf6" }, // violet
  manage: { label: "Manage", color: "#14b8a6" }, // teal
});

export function permissionTypeFromSlug(slug) {
  if (!slug || typeof slug !== "string") {
    return null;
  }

  const parts = slug.split(".").pop() || "";

  if (parts in PERMISSION_TYPE_INFO) {
    return parts;
  }

  return null;
}

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

// ---------- Catalogue statuses ----------

// Product lifecycle statuses.
export const PRODUCT_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  ARCHIVED: "ARCHIVED",
});

export const PRODUCT_STATUSES = Object.values(PRODUCT_STATUS);

export const INVENTORY_MODE = Object.freeze({
  SINGLE: "SINGLE",
  PER_SKU: "PER_SKU",
  BY_ATTRIBUTE: "BY_ATTRIBUTE",
});

export const INVENTORY_MODES = Object.values(INVENTORY_MODE);

export const INVENTORY_MODE_LABELS = Object.freeze({
  [INVENTORY_MODE.SINGLE]: "Single stock for all",
  [INVENTORY_MODE.PER_SKU]: "Per SKU",
  [INVENTORY_MODE.BY_ATTRIBUTE]: "By attribute",
});

export const CATEGORY_STATUS = STATUS;
export const CATEGORY_STATUSES = STATUSES;

export const BRAND_STATUS = STATUS;
export const BRAND_STATUSES = STATUSES;

export const ATTRIBUTE_STATUS = STATUS;
export const ATTRIBUTE_STATUSES = STATUSES;

export const CUSTOMER_STATUS = USER_STATUS;
export const CUSTOMER_STATUSES = USER_STATUSES;

// ---------- Orders ----------

// Order lifecycle statuses.
export const ORDER_STATUS = Object.freeze({
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  PROCESSING: "PROCESSING",
  PACKED: "PACKED",
  SHIPPED: "SHIPPED",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
});

export const ORDER_STATUSES = Object.values(ORDER_STATUS);

export const ORDER_STATUS_LABELS = Object.freeze({
  [ORDER_STATUS.PENDING]: "Pending",
  [ORDER_STATUS.CONFIRMED]: "Confirmed",
  [ORDER_STATUS.PROCESSING]: "Processing",
  [ORDER_STATUS.PACKED]: "Packed",
  [ORDER_STATUS.SHIPPED]: "Shipped",
  [ORDER_STATUS.OUT_FOR_DELIVERY]: "Out for delivery",
  [ORDER_STATUS.DELIVERED]: "Delivered",
  [ORDER_STATUS.CANCELLED]: "Cancelled",
  [ORDER_STATUS.REFUNDED]: "Refunded",
});

// Ordered chain of fulfilment states used to validate that an order
// can only move forward through the lifecycle.
export const ORDER_FLOW = Object.freeze([
  ORDER_STATUS.PENDING,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.PACKED,
  ORDER_STATUS.SHIPPED,
  ORDER_STATUS.OUT_FOR_DELIVERY,
  ORDER_STATUS.DELIVERED,
]);

export const PAYMENT_STATUS = Object.freeze({
  PENDING: "PENDING",
  PAID: "PAID",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
});

export const PAYMENT_STATUSES = Object.values(PAYMENT_STATUS);

export const PAYMENT_STATUS_LABELS = Object.freeze({
  [PAYMENT_STATUS.PENDING]: "Pending",
  [PAYMENT_STATUS.PAID]: "Paid",
  [PAYMENT_STATUS.FAILED]: "Failed",
  [PAYMENT_STATUS.REFUNDED]: "Refunded",
});

export const ORDER_PAYMENT_METHODS = Object.freeze({
  CARD: "card",
  COD: "cod",
  UPI: "upi",
});

export const ORDER_PAYMENT_METHODS_LABELS = Object.freeze({
  [ORDER_PAYMENT_METHODS.CARD]: "Card",
  [ORDER_PAYMENT_METHODS.COD]: "Cash on Delivery",
  [ORDER_PAYMENT_METHODS.UPI]: "UPI",
});

// ---------- Coupons ----------

export const COUPON_STATUS = STATUS;
export const COUPON_STATUSES = STATUSES;

export const COUPON_TYPE = Object.freeze({
  PERCENTAGE: "PERCENTAGE",
  FIXED: "FIXED",
});

export const COUPON_TYPES = Object.values(COUPON_TYPE);

export const COUPON_TYPE_LABELS = Object.freeze({
  [COUPON_TYPE.PERCENTAGE]: "Percentage (%)",
  [COUPON_TYPE.FIXED]: "Fixed amount",
});

// Validation rules applied on the storefront/backend when a coupon is
// used. Kept here so admin UI and checkout share the same limits.
export const COUPON_LIMITS = Object.freeze({
  MAX_CODE_LENGTH: 32,
  MIN_PERCENTAGE: 1,
  MAX_PERCENTAGE: 100,
  MIN_FIXED_AMOUNT: 1,
});

// ---------- Gift Cards ----------

// Admin-issued stored value redeemed at storefront checkout.
// EXPIRED is derived from expires_at and is filterable but never stored;
// REDEEMED is the stored equivalent of "fully used".
export const GIFT_CARD_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  EXPIRED: "EXPIRED",
  REDEEMED: "REDEEMED",
  CANCELLED: "CANCELLED",
});

export const GIFT_CARD_STATUSES = Object.freeze(
  Object.values(GIFT_CARD_STATUS).filter((s) => s !== GIFT_CARD_STATUS.EXPIRED)
);

// Where a card came from. PURCHASED is set only by the customer purchase
// flow once payment settles; everything else is issued by the store.
export const GIFT_CARD_SOURCE = Object.freeze({
  FIXED: "FIXED",
  CUSTOM: "CUSTOM",
  PROMOTIONAL: "PROMOTIONAL",
  BULK: "BULK",
  PURCHASED: "PURCHASED",
});

export const GIFT_CARD_SOURCES = Object.values(GIFT_CARD_SOURCE);

// Stored-value ledger entry types.
export const GIFT_CARD_TX_TYPE = Object.freeze({
  ISSUE: "ISSUE",
  PURCHASED: "PURCHASED",
  ACTIVATED: "ACTIVATED",
  REDEEM: "REDEEM",
  REFUND: "REFUND",
  REVERSAL: "REVERSAL",
  ADJUSTMENT: "ADJUSTMENT",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
});

export const GIFT_CARD_TX_TYPES = Object.values(GIFT_CARD_TX_TYPE);

// ---------- Reviews ----------

// Moderation status for customer product reviews.
export const REVIEW_STATUS = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
});

export const REVIEW_STATUSES = Object.values(REVIEW_STATUS);

export const REVIEW_STATUS_LABELS = Object.freeze({
  [REVIEW_STATUS.PENDING]: "Pending",
  [REVIEW_STATUS.APPROVED]: "Approved",
  [REVIEW_STATUS.REJECTED]: "Rejected",
});

// Rating bounds the storefront accepts.
export const REVIEW_RATING = Object.freeze({ MIN: 1, MAX: 5 });

// ---------- Banners ----------

export const BANNER_STATUS = STATUS;
export const BANNER_STATUSES = STATUSES;

export const BANNER_POSITIONS = Object.freeze({
  HERO: "hero",
  PROMO: "promo",
});

export const BANNER_POSITIONS_LABELS = Object.freeze({
  [BANNER_POSITIONS.HERO]: "Hero slider",
  [BANNER_POSITIONS.PROMO]: "Promo strip",
});

// ---------- Shared helpers ----------

// Builds a URL-safe slug from any text (used by categories, brands,
// attributes and coupons in both admin UI and backend validation).
export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Formats a JS Date to the compact "2026-09-17 12:30" shape used by
// the admin tables.
export function formatDateTime(value) {
  if (!value) {
    return "";
  }

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return "";
  }

  const pad = (n) => String(n).padStart(2, "0");

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Formats a number as currency with the Indian Rupee symbol.
export function formatCurrency(value) {
  const n = Number(value || 0);

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}