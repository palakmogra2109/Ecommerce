const API_URL = "http://localhost:3000/api";

export async function listCoupons(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.search) {
    searchParams.set("search", params.search);
  }

  if (params.status) {
    searchParams.set("status", params.status);
  }

  if (params.type) {
    searchParams.set("type", params.type);
  }

  if (params.page) {
    searchParams.set("page", params.page);
  }

  if (params.limit) {
    searchParams.set("limit", params.limit);
  }

  const query = searchParams.toString();

  const response = await fetch(
    `${API_URL}/coupons${query ? `?${query}` : ""}`,
    { method: "GET", credentials: "include" }
  );

  return await response.json();
}

export async function bulkUpdateCouponStatus(ids, status) {
  const response = await fetch(`${API_URL}/coupons/bulk-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ids, status }),
  });

  return await response.json();
}

export async function getCoupon(id) {
  const response = await fetch(`${API_URL}/coupons/${id}`, {
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function createCoupon(data) {
  const response = await fetch(`${API_URL}/coupons`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function updateCoupon(id, data) {
  const response = await fetch(`${API_URL}/coupons/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function deleteCoupon(id) {
  const response = await fetch(`${API_URL}/coupons/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  return await response.json();
}