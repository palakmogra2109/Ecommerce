const API_URL = "http://localhost:3000/api";

export async function listPermissions(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.module) {
    searchParams.set("module", params.module);
  }

  if (params.search) {
    searchParams.set("search", params.search);
  }

  if (params.page) {
    searchParams.set("page", params.page);
  }

  if (params.limit) {
    searchParams.set("limit", params.limit);
  }

  const query = searchParams.toString();

  const response = await fetch(
    `${API_URL}/permissions${query ? `?${query}` : ""}`,
    {
      method: "GET",
      credentials: "include",
    }
  );

  return await response.json();
}

export async function getPermission(id) {
  const response = await fetch(
    `${API_URL}/permissions/${id}`,
    {
      method: "GET",
      credentials: "include",
    }
  );

  return await response.json();
}

export async function createPermission(data) {
  const response = await fetch(`${API_URL}/permissions`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    credentials: "include",

    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function updatePermission(id, data) {
  const response = await fetch(
    `${API_URL}/permissions/${id}`,
    {
      method: "PATCH",

      headers: {
        "Content-Type": "application/json",
      },

      credentials: "include",

      body: JSON.stringify(data),
    }
  );

  return await response.json();
}

export async function deletePermission(id) {
  const response = await fetch(
    `${API_URL}/permissions/${id}`,
    {
      method: "DELETE",
      credentials: "include",
    }
  );

  return await response.json();
}