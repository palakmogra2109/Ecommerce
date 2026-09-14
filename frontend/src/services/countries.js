const API_URL = "http://localhost:3000/api";

export async function listCountries() {
  const response = await fetch(`${API_URL}/countries`, {
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}
