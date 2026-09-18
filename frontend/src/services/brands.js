const API_URL = "http://localhost:3000/api";

export async function listBrands(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.search) {
    searchParams.set("search", params.search);
  }

  if (params.status) {
    searchParams.set("status", params.status);
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
    `${API_URL}/brands${query ? `?${query}` : ""}`,
    { method: "GET", credentials: "include" }
  );

  return await response.json();
}

export async function bulkUpdateBrandStatus(ids, status) {
  const response = await fetch(`${API_URL}/brands/bulk-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ids, status }),
  });

  return await response.json();
}

export async function getBrand(id) {
  const response = await fetch(`${API_URL}/brands/${id}`, {
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function createBrand(data) {
  const response = await fetch(`${API_URL}/brands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function updateBrand(id, data) {
  const response = await fetch(`${API_URL}/brands/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function deleteBrand(id) {
  const response = await fetch(`${API_URL}/brands/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  return await response.json();
}