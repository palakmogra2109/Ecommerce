import { authHeaders } from "./http";

const API_URL = "/api";

export async function listAttributeValues(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.search) {
    searchParams.set("search", params.search);
  }

  if (params.status) {
    searchParams.set("status", params.status);
  }

  // The parent attribute's uuid, matching how categories addresses its parent.
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
    `${API_URL}/attribute-values${query ? `?${query}` : ""}`,
    {
      headers: authHeaders(), method: "GET", credentials: "include" }
  );

  return await response.json();
}

export async function getAttributeValue(id) {
  const response = await fetch(`${API_URL}/attribute-values/${id}`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function createAttributeValue(data) {
  const response = await fetch(`${API_URL}/attribute-values`, {
    method: "POST",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function updateAttributeValue(id, data) {
  const response = await fetch(`${API_URL}/attribute-values/${id}`, {
    method: "PATCH",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function deleteAttributeValue(id) {
  const response = await fetch(`${API_URL}/attribute-values/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
    credentials: "include",
  });

  return await response.json();
}

export async function bulkUpdateAttributeValueStatus(ids, status) {
  const response = await fetch(`${API_URL}/attribute-values/bulk-status`, {
    method: "POST",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ids, status }),
  });

  return await response.json();
}
