import { authHeaders } from "./http";

const API_URL = "/api";

export async function listBanners(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.search) {
    searchParams.set("search", params.search);
  }

  if (params.status) {
    searchParams.set("status", params.status);
  }

  if (params.position) {
    searchParams.set("position", params.position);
  }

  if (params.page) {
    searchParams.set("page", params.page);
  }

  if (params.limit) {
    searchParams.set("limit", params.limit);
  }

  const query = searchParams.toString();

  const response = await fetch(
    `${API_URL}/banners${query ? `?${query}` : ""}`,
    {
    headers: authHeaders(), method: "GET", credentials: "include" }
  );

  return await response.json();
}

export async function bulkUpdateBannerStatus(ids, status) {
  const response = await fetch(`${API_URL}/banners/bulk-status`, {
    method: "POST",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ids, status }),
  });

  return await response.json();
}

export async function getBanner(id) {
  const response = await fetch(`${API_URL}/banners/${id}`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function createBanner(data) {
  const response = await fetch(`${API_URL}/banners`, {
    method: "POST",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function updateBanner(id, data) {
  const response = await fetch(`${API_URL}/banners/${id}`, {
    method: "PATCH",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function deleteBanner(id) {
  const response = await fetch(`${API_URL}/banners/${id}`, {
    headers: authHeaders(),
    method: "DELETE",
    credentials: "include",
  });

  return await response.json();
}