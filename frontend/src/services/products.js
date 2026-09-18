const API_URL = "http://localhost:3000/api";

export async function listProducts(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.search) {
    searchParams.set("search", params.search);
  }

  if (params.status) {
    searchParams.set("status", params.status);
  }

  if (params.categoryUuid) {
    searchParams.set("category", params.categoryUuid);
  }

  if (params.brandUuid) {
    searchParams.set("brand", params.brandUuid);
  }

  if (params.featured) {
    searchParams.set("featured", params.featured);
  }

  if (params.page) {
    searchParams.set("page", params.page);
  }

  if (params.limit) {
    searchParams.set("limit", params.limit);
  }

  const query = searchParams.toString();

  const response = await fetch(
    `${API_URL}/products${query ? `?${query}` : ""}`,
    { method: "GET", credentials: "include" }
  );

  return await response.json();
}

export async function getProduct(id) {
  const response = await fetch(`${API_URL}/products/${id}`, {
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function createProduct(data) {
  const response = await fetch(`${API_URL}/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function updateProduct(id, data) {
  const response = await fetch(`${API_URL}/products/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function deleteProduct(id) {
  const response = await fetch(`${API_URL}/products/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  return await response.json();
}

export async function bulkUpdateInventory(items) {
  const response = await fetch(`${API_URL}/products/bulk-inventory`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ items }),
  });

  return await response.json();
}