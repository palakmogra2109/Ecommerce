const API_URL = "http://localhost:3000/api";

export async function listCategories(params = {}) {
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

  if (params.parent) {
    searchParams.set("parent", params.parent);
  }

  if (params.all) {
    searchParams.set("all", "1");
  }

  if (params.page) {
    searchParams.set("page", params.page);
  }

  if (params.limit) {
    searchParams.set("limit", params.limit);
  }

  const query = searchParams.toString();

  const response = await fetch(
    `${API_URL}/categories${query ? `?${query}` : ""}`,
    { method: "GET", credentials: "include" }
  );

  return await response.json();
}

export async function bulkUpdateCategoryStatus(ids, status) {
  const response = await fetch(`${API_URL}/categories/bulk-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ids, status }),
  });

  return await response.json();
}

export async function getCategory(id) {
  const response = await fetch(`${API_URL}/categories/${id}`, {
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function createCategory(data) {
  const response = await fetch(`${API_URL}/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function updateCategory(id, data) {
  const response = await fetch(`${API_URL}/categories/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function deleteCategory(id) {
  const response = await fetch(`${API_URL}/categories/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  return await response.json();
}