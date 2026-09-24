import { authHeaders } from "./http";

const API_URL = "/api";

export async function listOrders(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.search) {
    searchParams.set("search", params.search);
  }

  if (params.status) {
    searchParams.set("status", params.status);
  }

  if (params.paymentStatus) {
    searchParams.set("paymentStatus", params.paymentStatus);
  }

  if (params.page) {
    searchParams.set("page", params.page);
  }

  if (params.limit) {
    searchParams.set("limit", params.limit);
  }

  const query = searchParams.toString();

  const response = await fetch(
    `${API_URL}/orders${query ? `?${query}` : ""}`,
    {
    headers: authHeaders(), method: "GET", credentials: "include" }
  );

  return await response.json();
}

export async function getOrder(id) {
  const response = await fetch(`${API_URL}/orders/${id}`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function updateOrder(id, data) {
  const response = await fetch(`${API_URL}/orders/${id}`, {
    method: "PATCH",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function cancelOrder(id) {
  const response = await fetch(`${API_URL}/orders/${id}`, {
    headers: authHeaders(),
    method: "POST",
    credentials: "include",
  });

  return await response.json();
}

export async function deleteOrder(id) {
  const response = await fetch(`${API_URL}/orders/${id}`, {
    headers: authHeaders(),
    method: "DELETE",
    credentials: "include",
  });

  return await response.json();
}