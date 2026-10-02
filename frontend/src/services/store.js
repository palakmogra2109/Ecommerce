import { authHeaders, storeToken } from "./http";

const API_URL = "/api";

export async function storeLogin(email, password) {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (data.success) {
    storeToken(data.token);
  }
  return data;
}

export async function storeDashboard(branchId) {
  const response = await fetch(`${API_URL}/store/dashboard`, {
    method: "GET",
    headers: {
    ...authHeaders(), "x-branch-id": branchId },
    credentials: "include",
  });
  return await response.json();
}

export async function storeProducts(branchId, params = {}) {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set("search", params.search);
  if (params.page) searchParams.set("page", params.page);
  if (params.limit) searchParams.set("limit", params.limit);
  const qs = searchParams.toString();
  const response = await fetch(`${API_URL}/store/my/products?${qs}`, {
    method: "GET",
    headers: {
    ...authHeaders(), "x-branch-id": branchId },
    credentials: "include",
  });
  return await response.json();
}

export async function storeUpdateProduct(branchId, uuid, data) {
  const response = await fetch(`${API_URL}/store/my/products/${uuid}`, {
    method: "PATCH",
    headers: {
    ...authHeaders(), "Content-Type": "application/json", "x-branch-id": branchId },
    credentials: "include",
    body: JSON.stringify({ ...data, branchId }),
  });
  return await response.json();
}

export async function storeOrders(branchId, params = {}) {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set("search", params.search);
  if (params.status) searchParams.set("status", params.status);
  if (params.page) searchParams.set("page", params.page);
  if (params.limit) searchParams.set("limit", params.limit);
  searchParams.set("branchId", branchId);
  const qs = searchParams.toString();
  const response = await fetch(`${API_URL}/store/my/orders?${qs}`, {
    method: "GET",
    headers: {
    ...authHeaders(), "x-branch-id": branchId },
    credentials: "include",
  });
  return await response.json();
}

export async function storeUpdateOrder(branchId, uuid, data) {
  const response = await fetch(`${API_URL}/store/my/orders/${uuid}`, {
    method: "PATCH",
    headers: {
    ...authHeaders(), "Content-Type": "application/json", "x-branch-id": branchId },
    credentials: "include",
    body: JSON.stringify({ ...data, branchId }),
  });
  return await response.json();
}

export async function storeOrderDetail(branchId, uuid) {
  const response = await fetch(`${API_URL}/store/my/orders/${uuid}`, {
    method: "GET",
    headers: {
    ...authHeaders(), "x-branch-id": branchId },
    credentials: "include",
  });
  return await response.json();
}

export async function storeProfile(branchId) {
  const response = await fetch(`${API_URL}/store/me`, {
    method: "GET",
    headers: {
    ...authHeaders(), "x-branch-id": branchId },
    credentials: "include",
  });
  return await response.json();
}

export async function storeUpdateProfile(branchId, data) {
  const response = await fetch(`${API_URL}/store/me`, {
    method: "PATCH",
    headers: {
    ...authHeaders(), "Content-Type": "application/json", "x-branch-id": branchId },
    credentials: "include",
    body: JSON.stringify({ ...data, branchId }),
  });
  return await response.json();
}

export async function storeCancelOrder(branchId, uuid) {
  const response = await fetch(`${API_URL}/store/my/orders/${uuid}`, {
    method: "DELETE",
    headers: {
    ...authHeaders(), "x-branch-id": branchId },
    credentials: "include",
  });
  return await response.json();
}

// Lists admin-created ACTIVE products not yet added to this store
// (for the "Add Product" dropdown).
export async function storeAvailableProducts(branchId, search = "") {
  const query = new URLSearchParams({ branchId });
  if (search) query.set("search", search);

  const response = await fetch(
    `${API_URL}/store/my/products/available?${query.toString()}`,
    {
      method: "GET",
      headers: {
      ...authHeaders(), "x-branch-id": branchId },
      credentials: "include",
    }
  );
  return await response.json();
}

// Adds an admin product to the store with the store's own price + stock.
export async function storeAddProduct(branchId, data) {
  const response = await fetch(`${API_URL}/store/my/products/add`, {
    method: "POST",
    headers: {
    ...authHeaders(), "Content-Type": "application/json", "x-branch-id": branchId },
    credentials: "include",
    body: JSON.stringify({ ...data, branchId }),
  });
  return await response.json();
}

// Stock ledger for one store product: when stock was received/deducted.
export async function storeStockHistory(branchId, uuid) {
  const response = await fetch(
    `${API_URL}/store/my/products/${uuid}/stock-history`,
    {
      method: "GET",
      headers: {
      ...authHeaders(), "x-branch-id": branchId },
      credentials: "include",
    }
  );
  return await response.json();
}

// Returns the order bill/invoice PDF as a Blob for the store panel.
export async function storeOrderInvoice(branchId, uuid) {
  const response = await fetch(`${API_URL}/store/my/orders/${uuid}/invoice`, {
    method: "GET",
    headers: {
    ...authHeaders(), "x-branch-id": branchId },
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to download invoice");
  }

  return await response.blob();
}
