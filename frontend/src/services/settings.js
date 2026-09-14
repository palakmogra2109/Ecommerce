const API_URL = "http://localhost:3000/api";

export async function getSettings() {
  const response = await fetch(`${API_URL}/settings`, {
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function updateSettings(data) {
  const response = await fetch(`${API_URL}/settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}