import { authHeaders } from "./http";

const API_URL = "/api";

export async function listRoles(params = {}) {
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
    `${API_URL}/roles${query ? `?${query}` : ""}`,
    {
      headers: authHeaders(),
      method: "GET",
      credentials: "include",
    }
  );

  return await response.json();
}

export async function bulkUpdateRoleStatus(ids, status) {
  const response = await fetch(`${API_URL}/roles/bulk-status`, {
    method: "POST",

    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },

    credentials: "include",

    body: JSON.stringify({ ids, status }),
  });

  return await response.json();
}

export async function getRole(id) {
  const response = await fetch(`${API_URL}/roles/${id}`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function createRole(data) {
  const response = await fetch(`${API_URL}/roles`, {
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

export async function updateRole(id, data) {
  const response = await fetch(`${API_URL}/roles/${id}`, {
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

export async function deleteRole(id) {
  const response = await fetch(`${API_URL}/roles/${id}`, {
    headers: authHeaders(),
    method: "DELETE",
    credentials: "include",
  });

  return await response.json();
}

export async function getRolePermissions(id) {
  const response = await fetch(
    `${API_URL}/roles/${id}/permissions`,
    {
      headers: authHeaders(),
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
        ...authHeaders(),
        "Content-Type": "application/json",
      },

      credentials: "include",

      body: JSON.stringify({ permissions: permissionIds }),
    }
  );

  return await response.json();
}

export async function listUsersByRole(roleId, params = {}) {
  const searchParams = new URLSearchParams();

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
    `${API_URL}/roles/${roleId}/users${query ? `?${query}` : ""}`,
    {
      headers: authHeaders(),
      method: "GET",
      credentials: "include",
    }
  );

  return await response.json();
}