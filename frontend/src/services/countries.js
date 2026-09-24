import { authHeaders } from "./http";

const API_URL = "/api";

export async function listCountries() {
  const response = await fetch(`${API_URL}/countries`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}
