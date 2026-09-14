const API_URL = "http://localhost:3000/api";

export async function listEmailTemplates(params = {}) {
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
    `${API_URL}/email-templates${query ? `?${query}` : ""}`,
    {
      method: "GET",
      credentials: "include",
    }
  );

  return await response.json();
}

export async function bulkUpdateEmailTemplateStatus(ids, status) {
  const response = await fetch(
    `${API_URL}/email-templates/bulk-status`,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      credentials: "include",

      body: JSON.stringify({ ids, status }),
    }
  );

  return await response.json();
}

export async function getEmailTemplate(id) {
  const response = await fetch(`${API_URL}/email-templates/${id}`, {
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function createEmailTemplate(data) {
  const response = await fetch(`${API_URL}/email-templates`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    credentials: "include",

    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function updateEmailTemplate(id, data) {
  const response = await fetch(`${API_URL}/email-templates/${id}`, {
    method: "PATCH",

    headers: {
      "Content-Type": "application/json",
    },

    credentials: "include",

    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function deleteEmailTemplate(id) {
  const response = await fetch(`${API_URL}/email-templates/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  return await response.json();
}