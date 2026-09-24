import { authHeaders } from "./http";

const API_URL = "/api";

export async function listUsers(params = {}) {
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
    `${API_URL}/users${query ? `?${query}` : ""}`,
    {
      headers: authHeaders(),
      method: "GET",
      credentials: "include",
    }
  );

  return await response.json();
}

export async function getUser(id) {
  const response = await fetch(`${API_URL}/users/${id}`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function createUser(data) {
  const response = await fetch(`${API_URL}/users`, {
    method: "POST",

    headers: {
      ...authHeaders(),
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
      ...authHeaders(),
      "Content-Type": "application/json",
    },

    credentials: "include",

    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function deleteUser(id) {
  const response = await fetch(`${API_URL}/users/${id}`, {
    headers: authHeaders(),
    method: "DELETE",
    credentials: "include",
  });

  return await response.json();
}

export async function getUserPermissions(id) {
  const response = await fetch(
    `${API_URL}/users/${id}/permissions`,
    {
      headers: authHeaders(),
      method: "GET",
      credentials: "include",
    }
  );

  return await response.json();
}

export async function updateUserPermissions(id, permissionIds) {
  const response = await fetch(
    `${API_URL}/users/${id}/permissions`,
    {
      method: "PUT",

      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },

      credentials: "include",

      body: JSON.stringify({ permissions: permissionIds }),
    }
  );

  return await response.json();
}

export async function bulkUpdateUserStatus(ids, status) {
  const response = await fetch(
    `${API_URL}/users/bulk-status`,
    {
      method: "POST",

      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },

      credentials: "include",

      body: JSON.stringify({ ids, status }),
    }
  );

  return await response.json();
}