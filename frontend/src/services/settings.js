import { authHeaders } from "./http";

const API_URL = "/api";

export async function getSettings() {
  const response = await fetch(`${API_URL}/settings`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function updateSettings(data) {
  const response = await fetch(`${API_URL}/settings`, {
    method: "PUT",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}