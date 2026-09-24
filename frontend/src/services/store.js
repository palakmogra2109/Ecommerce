const API_URL = "http://localhost:3000/api";

export async function storeRegister(data) {
  const response = await fetch(`${API_URL}/auth/store/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  return await response.json();
}

export async function storeLogin(email, password) {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  return await response.json();
}

export async function storeDashboard(branchId) {
  const response = await fetch(`${API_URL}/store/dashboard`, {
    method: "GET",
    headers: { "x-branch-id": branchId },
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
    headers: { "x-branch-id": branchId },
    credentials: "include",
  });
  return await response.json();
}

export async function storeUpdateProduct(branchId, uuid, data) {
  const response = await fetch(`${API_URL}/store/my/products/${uuid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-branch-id": branchId },
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
    headers: { "x-branch-id": branchId },
    credentials: "include",
  });
  return await response.json();
}

export async function storeUpdateOrder(branchId, uuid, data) {
  const response = await fetch(`${API_URL}/store/my/orders/${uuid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-branch-id": branchId },
    credentials: "include",
    body: JSON.stringify({ ...data, branchId }),
  });
  return await response.json();
}

export async function storeOrderDetail(branchId, uuid) {
  const response = await fetch(`${API_URL}/store/my/orders/${uuid}`, {
    method: "GET",
    headers: { "x-branch-id": branchId },
    credentials: "include",
  });
  return await response.json();
}

export async function storeProfile(branchId) {
  const response = await fetch(`${API_URL}/store/me`, {
    method: "GET",
    headers: { "x-branch-id": branchId },
    credentials: "include",
  });
  return await response.json();
}

export async function storeUpdateProfile(branchId, data) {
  const response = await fetch(`${API_URL}/store/me`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-branch-id": branchId },
    credentials: "include",
    body: JSON.stringify({ ...data, branchId }),
  });
  return await response.json();
}
