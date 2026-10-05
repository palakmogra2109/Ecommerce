import { authHeaders } from "./http";

const API_URL = "/api";

// Reference geography for address pickers. Separate from services/countries.js,
// which is the phone dial-code list used by the phone field, not this data.

function query(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

async function unwrap(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function listGeoCountries() {
  return await unwrap(await fetch(`${API_URL}/geo/countries`, {
    headers: authHeaders(), method: "GET", credentials: "include",
  }));
}

export async function listGeoStates({ country, search, limit } = {}) {
  return await unwrap(await fetch(`${API_URL}/geo/states${query({ country, search, limit })}`, {
    headers: authHeaders(), method: "GET", credentials: "include",
  }));
}

export async function listGeoCities({ state, country, search, limit } = {}) {
  return await unwrap(await fetch(`${API_URL}/geo/cities${query({ state, country, search, limit })}`, {
    headers: authHeaders(), method: "GET", credentials: "include",
  }));
}
