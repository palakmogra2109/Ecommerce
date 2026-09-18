const API_URL = "http://localhost:3000/api";

export async function listAttributes(params = {}) {
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
    `${API_URL}/attributes${query ? `?${query}` : ""}`,
    { method: "GET", credentials: "include" }
  );

  return await response.json();
}

export async function getAttribute(id) {
  const response = await fetch(`${API_URL}/attributes/${id}`, {
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function createAttribute(data) {
  const response = await fetch(`${API_URL}/attributes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function updateAttribute(id, data) {
  const response = await fetch(`${API_URL}/attributes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function deleteAttribute(id) {
  const response = await fetch(`${API_URL}/attributes/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  return await response.json();
}