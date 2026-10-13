// Shared constants used across all panels
export const INVENTORY_MODES = {
  PER_SKU: 'PER_SKU',
  INVENTORY_ATTRIBUTE: 'INVENTORY_ATTRIBUTE',
  COMBINED: 'COMBINED',
};

export const PRODUCT_STATUSES = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
};

export const KEY_PERMISSIONS = {
  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_CREATE: 'products.create',
  PRODUCTS_EDIT: 'products.edit',
  ORDERS_VIEW: 'orders.view',
  ORDERS_CREATE: 'orders.create',
  CUSTOMERS_VIEW: 'customers.view',
  // ... add more as needed
};

export const DEFAULT_THRESHOLDS = {
  LOW_STOCK: 5,
  OUT_OF_STOCK: 0,
};
