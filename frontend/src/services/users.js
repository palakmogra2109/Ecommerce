const API_URL = "http://localhost:3000/api";

export async function listUsers(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.search) {
    searchParams.set("search", params.search);
  }

  if (params.status) {
    searchParams.set("status", params.status);
  }

  const query = searchParams.toString();

  const response = await fetch(
    `${API_URL}/users${query ? `?${query}` : ""}`,
    {
      method: "GET",
      credentials: "include",
    }
  );

  return await response.json();
}

export async function getUser(id) {
  const response = await fetch(`${API_URL}/users/${id}`, {
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function createUser(data) {
  const response = await fetch(`${API_URL}/users`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    credentials: "include",

    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function updateUser(id, data) {
  const response = await fetch(`${API_URL}/users/${id}`, {
    method: "PATCH",

    headers: {
      "Content-Type": "application/json",
    },

    credentials: "include",

    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function deleteUser(id) {
  const response = await fetch(`${API_URL}/users/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  return await response.json();
}