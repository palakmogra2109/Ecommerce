const API_URL = "http://localhost:3000/api";

export async function listReviews(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.search) {
    searchParams.set("search", params.search);
  }

  if (params.status) {
    searchParams.set("status", params.status);
  }

  if (params.rating) {
    searchParams.set("rating", params.rating);
  }

  if (params.page) {
    searchParams.set("page", params.page);
  }

  if (params.limit) {
    searchParams.set("limit", params.limit);
  }

  const query = searchParams.toString();

  const response = await fetch(
    `${API_URL}/reviews${query ? `?${query}` : ""}`,
    { method: "GET", credentials: "include" }
  );

  return await response.json();
}

export async function moderateReview(id, status, note) {
  const response = await fetch(
    `${API_URL}/reviews/${id}?action=moderate`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status, note }),
    }
  );

  return await response.json();
}

export async function updateReview(id, data) {
  const response = await fetch(`${API_URL}/reviews/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function deleteReview(id) {
  const response = await fetch(`${API_URL}/reviews/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  return await response.json();
}