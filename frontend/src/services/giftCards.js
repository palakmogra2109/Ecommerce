import { authHeaders } from "./http";

const API_URL = "/api";

export async function listGiftCards(params = {}) {
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
    `${API_URL}/gift-cards${query ? `?${query}` : ""}`,
    {
    headers: authHeaders(), method: "GET", credentials: "include" }
  );

  return await response.json();
}

export async function getGiftCard(id) {
  const response = await fetch(`${API_URL}/gift-cards/${id}`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function createGiftCard(data) {
  const response = await fetch(`${API_URL}/gift-cards`, {
    method: "POST",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function updateGiftCard(id, data) {
  const response = await fetch(`${API_URL}/gift-cards/${id}`, {
    method: "PATCH",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function deleteGiftCard(id) {
  const response = await fetch(`${API_URL}/gift-cards/${id}`, {
    headers: authHeaders(),
    method: "DELETE",
    credentials: "include",
  });

  return await response.json();
}
