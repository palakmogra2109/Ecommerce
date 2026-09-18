const API_URL = "http://localhost:3000/api";

export async function listCustomers(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.search) {
    searchParams.set("search", params.search);
  }

  if (params.status) {
    searchParams.set("status", params.status);
  }

  if (params.page) {
    searchParams.set("page", params.page);
  }

  if (params.limit) {
    searchParams.set("limit", params.limit);
  }

  const query = searchParams.toString();

  const response = await fetch(
    `${API_URL}/customers${query ? `?${query}` : ""}`,
    { method: "GET", credentials: "include" }
  );

  return await response.json();
}

export async function getCustomer(id) {
  const response = await fetch(`${API_URL}/customers/${id}`, {
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function updateCustomer(id, data) {
  const response = await fetch(`${API_URL}/customers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function deleteCustomer(id) {
  const response = await fetch(`${API_URL}/customers/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  return await response.json();
}