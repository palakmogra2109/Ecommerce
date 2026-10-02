import { authHeaders } from "./http";

const API_URL = "/api";

export async function listGiftCards(params = {}) {
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
    `${API_URL}/gift-cards${query ? `?${query}` : ""}`,
    {
    headers: authHeaders(), method: "GET", credentials: "include" }
  );

  return await response.json();
}

export async function getGiftCard(id) {
  const response = await fetch(`${API_URL}/gift-cards/${id}`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });

  return await response.json();
}

export async function createGiftCard(data) {
  const response = await fetch(`${API_URL}/gift-cards`, {
    method: "POST",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function updateGiftCard(id, data) {
  const response = await fetch(`${API_URL}/gift-cards/${id}`, {
    method: "PATCH",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function deleteGiftCard(id) {
  const response = await fetch(`${API_URL}/gift-cards/${id}`, {
    headers: authHeaders(),
    method: "DELETE",
    credentials: "include",
  });

  return await response.json();
}

// Bulk issue returns full codes exactly once (they are hash-stored and cannot
// be recovered afterwards), so the caller must export them immediately.
export async function bulkCreateGiftCards(data) {
  const response = await fetch(`${API_URL}/gift-cards/bulk`, {
    method: "POST",
    headers: {
    ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  return await response.json();
}

export async function getGiftCardStats() {
  const response = await fetch(`${API_URL}/gift-cards/stats`, {
    headers: authHeaders(),
    credentials: "include",
  });

  return await response.json();
}

// Turns issued codes into a downloadable CSV. Full codes are only present in
// this immediate response, so the file is built here in the browser.
export function giftCardsToCsv(giftCards) {
  const header = ["code", "amount", "balance", "recipient_email", "expires_at"];
  const escape = (value) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = giftCards.map((card) =>
    [
      card.code,
      card.initial_amount,
      card.balance,
      card.recipient_email,
      card.expires_at,
    ]
      .map(escape)
      .join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

export function downloadGiftCardsCsv(giftCards, filename = "gift-cards.csv") {
  const blob = new Blob([giftCardsToCsv(giftCards)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---------- Denomination catalogue ----------
// The shop-facing E-Cards shelf: each row is a buyable product with a face
// value and, when promoted, a lower selling price.

export async function listDenominations() {
  const response = await fetch(`${API_URL}/gift-cards/denominations`, {
    headers: authHeaders(),
    credentials: "include",
  });
  return await response.json();
}

export async function createDenomination(data) {
  const response = await fetch(`${API_URL}/gift-cards/denominations`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  return await response.json();
}

export async function updateDenomination(uuid, data) {
  const response = await fetch(`${API_URL}/gift-cards/denominations/${uuid}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  return await response.json();
}

export async function deleteDenomination(uuid) {
  const response = await fetch(`${API_URL}/gift-cards/denominations/${uuid}`, {
    method: "DELETE",
    headers: authHeaders(),
    credentials: "include",
  });
  return await response.json();
}

// Brands, categories and products for the scope picker, in one request.
export async function getGiftCardReferences() {
  const response = await fetch(`${API_URL}/gift-cards/references`, {
    headers: authHeaders(),
    credentials: "include",
  });
  return await response.json();
}
