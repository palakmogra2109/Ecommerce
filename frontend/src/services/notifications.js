import { authHeaders } from "./http";

const API_URL = "/api";

/**
 * The signed-in admin's own notification inbox.
 *
 * The route resolves the owner from the session, not from a request header, so
 * there is no user id to pass here and no way to read someone else's.
 */
export async function listNotifications({ limit = 50, unreadOnly = false } = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (unreadOnly) params.set("unread", "1");

  const response = await fetch(`${API_URL}/notifications?${params}`, {
    method: "GET",
    headers: authHeaders(),
    credentials: "include",
  });

  return await response.json();
}

/**
 * Marks notifications read and returns the new unread count.
 *
 * An empty `uuids` list means "all of them", which is what the mark-all-read
 * control sends.
 */
export async function markNotificationsRead(uuids) {
  const response = await fetch(`${API_URL}/notifications`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ uuids: uuids && uuids.length ? uuids : null }),
  });

  return await response.json();
}