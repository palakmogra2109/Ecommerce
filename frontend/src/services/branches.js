import { authHeaders } from "./http";

const API_URL = "/api";

export async function listBranches(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.search) {
    searchParams.set("search", params.search);
  }
  if (params.status) {
    searchParams.set("status", params.status);
  }
  if (params.city) {
    searchParams.set("city", params.city);
  }
  if (params.page) {
    searchParams.set("page", params.page);
  }
  if (params.limit) {
    searchParams.set("limit", params.limit);
  }

  const response = await fetch(`${API_URL}/branches?${searchParams}`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });
  return await response.json();
}

export async function getBranch(uuid) {
  const response = await fetch(`${API_URL}/branches/${uuid}`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });
  return await response.json();
}

export async function createBranch(data) {
  const response = await fetch(`${API_URL}/branches`, {
    method: "POST",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  return await response.json();
}

export async function updateBranch(uuid, data) {
  const response = await fetch(`${API_URL}/branches/${uuid}`, {
    method: "PATCH",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  return await response.json();
}

export async function deleteBranch(uuid) {
  const response = await fetch(`${API_URL}/branches/${uuid}`, {
    headers: authHeaders(),
    method: "DELETE",
    credentials: "include",
  });
  return await response.json();
}

export async function getBranchProducts(branchId, params = {}) {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set("search", params.search);
  if (params.status) searchParams.set("status", params.status);
  if (params.page) searchParams.set("page", params.page);
  if (params.limit) searchParams.set("limit", params.limit);

  const response = await fetch(`${API_URL}/branches/${branchId}/products?${searchParams}`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });
  return await response.json();
}

export async function getBranchInventory(branchId, params = {}) {
  const searchParams = new URLSearchParams();
  if (params.type) searchParams.set("type", params.type);
  if (params.page) searchParams.set("page", params.page);
  if (params.limit) searchParams.set("limit", params.limit);

  const response = await fetch(`${API_URL}/branches/${branchId}/inventory?${searchParams}`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });
  return await response.json();
}

export async function getBranchDashboard(branchId) {
  const response = await fetch(`${API_URL}/branches/${branchId}/dashboard`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });
  return await response.json();
}

export async function listNearbyBranches(lat, lng, radius = 50, limit = 10) {
  const response = await fetch(`${API_URL}/branches/nearby?lat=${lat}&lng=${lng}&radius=${radius}&limit=${limit}`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });
  return await response.json();
}

export async function getTransfer(transferId) {
  const response = await fetch(`${API_URL}/branches/transfers/${transferId}`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });
  return await response.json();
}

export async function updateTransfer(transferId, data) {
  const response = await fetch(`${API_URL}/branches/transfers/${transferId}`, {
    method: "PATCH",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  return await response.json();
}

export async function listBranchOrders(branchId, params = {}) {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set("search", params.search);
  if (params.status) searchParams.set("status", params.status);
  if (params.page) searchParams.set("page", params.page);
  if (params.limit) searchParams.set("limit", params.limit);

  const response = await fetch(`${API_URL}/branches/${branchId}/orders?${searchParams}`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });
  return await response.json();
}

export async function updateBranchOrderStatus(branchId, orderId, status) {
  const response = await fetch(`${API_URL}/branches/${branchId}/orders/${orderId}`, {
    method: "PATCH",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ status }),
  });
  return await response.json();
}

export async function listBranchesForSelect() {
  const response = await fetch(`${API_URL}/branches?limit=100`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });
  return await response.json();
}

export async function listStoreAccounts(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.search) searchParams.set("search", params.search);
  if (params.status) searchParams.set("status", params.status);
  if (params.page) searchParams.set("page", params.page);
  if (params.limit) searchParams.set("limit", params.limit);

  const response = await fetch(`${API_URL}/branches/stores?${searchParams}`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });
  return await response.json();
}

export async function getBranchStoreUsers(branchId) {
  const response = await fetch(`${API_URL}/branches/${branchId}/users`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });
  return await response.json();
}

export async function addBranchStoreUser(branchId, userUuid) {
  const response = await fetch(`${API_URL}/branches/${branchId}/users`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ userUuid }),
  });
  return await response.json();
}

export async function removeBranchStoreUser(branchId, userUuid) {
  const response = await fetch(`${API_URL}/branches/${branchId}/users/${userUuid}`, {
    headers: authHeaders(),
    method: "DELETE",
    credentials: "include",
  });
  return await response.json();
}
