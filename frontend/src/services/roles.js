const API_URL = "http://localhost:3000/api";

export async function listRoles(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.search) {
    searchParams.set("search", params.search);
  }

  const query = searchParams.toString();

  const response = await fetch(
    `${API_URL}/roles${query ? `?${query}` : ""}`,
    {
      method: "GET",
      credentials: "include",
    }
  );

  return await response.json();
}

export async function getRole(id) {
  const response = await fetch(`${API_URL}/roles/${id}`, {
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function createRole(data) {
  const response = await fetch(`${API_URL}/roles`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    credentials: "include",

    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function updateRole(id, data) {
  const response = await fetch(`${API_URL}/roles/${id}`, {
    method: "PATCH",

    headers: {
      "Content-Type": "application/json",
    },

    credentials: "include",

    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function deleteRole(id) {
  const response = await fetch(`${API_URL}/roles/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  return await response.json();
}

export async function getRolePermissions(id) {
  const response = await fetch(
    `${API_URL}/roles/${id}/permissions`,
    {
      method: "GET",
      credentials: "include",
    }
  );

  return await response.json();
}

export async function updateRolePermissions(id, permissionIds) {
  const response = await fetch(
    `${API_URL}/roles/${id}/permissions`,
    {
      method: "PUT",

      headers: {
        "Content-Type": "application/json",
      },

      credentials: "include",

      body: JSON.stringify({ permissions: permissionIds }),
    }
  );

  return await response.json();
}