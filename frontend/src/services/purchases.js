import { authHeaders } from "./http";
import { listProducts } from "./products";

const API_URL = "/api";

// Suppliers and purchase invoices.
//
// The backend recomputes every figure from quantities and unit costs, so nothing
// here sends a total. Reading a total back off a form field and posting it would
// let a tampered form book a cheaper invoice.

function query(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

async function unwrap(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Surface the backend's own wording, which names the line that failed, rather
    // than replacing it with a generic "request failed".
    const error = new Error(payload.message || `Request failed (${response.status})`);
    error.code = payload.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

// ── suppliers ──────────────────────────────────────────────────────────────

export async function listSuppliers(params = {}) {
  return await unwrap(await fetch(`${API_URL}/suppliers${query(params)}`, {
    headers: authHeaders(), method: "GET", credentials: "include",
  }));
}

export async function getSupplier(id) {
  return await unwrap(await fetch(`${API_URL}/suppliers/${id}`, {
    headers: authHeaders(), method: "GET", credentials: "include",
  }));
}

export async function createSupplier(payload) {
  return await unwrap(await fetch(`${API_URL}/suppliers`, {
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    method: "POST", credentials: "include", body: JSON.stringify(payload),
  }));
}

export async function updateSupplier(id, payload) {
  return await unwrap(await fetch(`${API_URL}/suppliers/${id}`, {
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    method: "PATCH", credentials: "include", body: JSON.stringify(payload),
  }));
}

export async function retireSupplier(id) {
  return await unwrap(await fetch(`${API_URL}/suppliers/${id}`, {
    headers: authHeaders(), method: "DELETE", credentials: "include",
  }));
}

export async function restoreSupplier(id) {
  return await unwrap(await fetch(`${API_URL}/suppliers/${id}`, {
    headers: authHeaders(), method: "PUT", credentials: "include",
  }));
}

export async function listSupplierBankAccounts(supplierId) {
  return await unwrap(await fetch(`${API_URL}/suppliers/${supplierId}/bank-accounts`, {
    headers: authHeaders(), method: "GET", credentials: "include",
  }));
}

export async function createSupplierBankAccount(supplierId, payload) {
  return await unwrap(await fetch(`${API_URL}/suppliers/${supplierId}/bank-accounts`, {
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    method: "POST", credentials: "include", body: JSON.stringify(payload),
  }));
}

export async function updateSupplierBankAccount(supplierId, uuid, payload) {
  return await unwrap(await fetch(`${API_URL}/suppliers/${supplierId}/bank-accounts/${uuid}`, {
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    method: "PATCH", credentials: "include", body: JSON.stringify(payload),
  }));
}

export async function setPrimarySupplierBankAccount(supplierId, uuid) {
  return await unwrap(
    await fetch(`${API_URL}/suppliers/${supplierId}/bank-accounts/${uuid}?action=primary`, {
      headers: authHeaders(), method: "POST", credentials: "include",
    })
  );
}

export async function retireSupplierBankAccount(supplierId, uuid) {
  return await unwrap(await fetch(`${API_URL}/suppliers/${supplierId}/bank-accounts/${uuid}`, {
    headers: authHeaders(), method: "DELETE", credentials: "include",
  }));
}

/**
 * Active products for the line-item picker. Reuses the catalogue endpoint rather
 * than a purchases-specific one: the picker needs nothing a purchase line does
 * not already carry (id, name, sku, stock), so a second product query would just
 * be a second thing to keep in step with the catalogue.
 */
// Purchase invoices may be raised against any active product, so ask for the
// API maximum in one go rather than the default page of 20. The backend caps
// `limit` at MAX_LIMIT (100); typing in the box still narrows server-side.
export async function searchProductsForPurchase(search) {
  const data = await listProducts({ search, status: "ACTIVE", limit: 100 });
  return data.products || [];
}

// ── supplier bank accounts ────────────────────────────────────────────────
//
// Account numbers arrive masked (all but the last four digits) and there is no
// "reveal" call in this module on purpose: the UI shows the mask, full stop.

// ── purchase invoices ──────────────────────────────────────────────────────

export async function listPurchaseInvoices(params = {}) {
  return await unwrap(await fetch(`${API_URL}/purchase-invoices${query(params)}`, {
    headers: authHeaders(), method: "GET", credentials: "include",
  }));
}

export async function getPurchaseInvoice(id) {
  return await unwrap(await fetch(`${API_URL}/purchase-invoices/${id}`, {
    headers: authHeaders(), method: "GET", credentials: "include",
  }));
}

/**
 * `items` carries only productId, quantityOrdered, unitCost and the percentages.
 * No total is sent: the server derives it, and posting one would be ignored.
 */
export async function createPurchaseInvoice(payload) {
  return await unwrap(await fetch(`${API_URL}/purchase-invoices`, {
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    method: "POST", credentials: "include", body: JSON.stringify(payload),
  }));
}

/**
 * Records goods arriving. Only `accepted` becomes sellable stock; `damaged` and
 * `missing` are recorded against the invoice so the supplier can be queried.
 */
export async function receiveStock(id, payload) {
  return await unwrap(await fetch(`${API_URL}/purchase-invoices/${id}/receive`, {
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    method: "POST", credentials: "include", body: JSON.stringify(payload),
  }));
}

export async function payPurchaseInvoice(id, payload) {
  return await unwrap(await fetch(`${API_URL}/purchase-invoices/${id}/payments`, {
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    method: "POST", credentials: "include", body: JSON.stringify(payload),
  }));
}

/** A reason is required; the backend will not invent one. */
export async function cancelPurchaseInvoice(id, reason) {
  return await unwrap(await fetch(`${API_URL}/purchase-invoices/${id}`, {
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    method: "DELETE", credentials: "include", body: JSON.stringify({ reason }),
  }));
}