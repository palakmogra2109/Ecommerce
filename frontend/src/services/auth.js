import { authHeaders, getStoredToken, handleUnauthorizedResponse } from "./http";

const API_URL = "/api";

export async function loginUser(data) {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",

    headers: authHeaders({
      "Content-Type": "application/json",
    }),

    body: JSON.stringify(data),
  });

  handleUnauthorizedResponse(response);
  const payload = await response.json();

  // A throttled login (429) carries Retry-After: the seconds until this client
  // may try again. Surfaced so the login page can count down instead of only
  // saying "please wait". RFC 9110 also allows an HTTP-date here, and a proxy
  // can drop the header entirely, so anything non-numeric becomes null rather
  // than leaking a NaN onto the screen.
  const retryAfter = Number.parseInt(response.headers.get("Retry-After") || "", 10);

  return {
    ...payload,
    status: response.status,
    retryAfterSec: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  };
}

export async function logoutUser() {
  const response = await fetch(`${API_URL}/auth/logout`, {
    method: "POST",

    headers: authHeaders(),
  });

  return await response.json();
}

export async function forgotPassword(email) {
  const response = await fetch(
    `${API_URL}/auth/forgot-password`,
    {
      method: "POST",

      headers: authHeaders({
        "Content-Type": "application/json",
      }),

      body: JSON.stringify({ email }),
    }
  );

  return await response.json();
}

export async function resetPassword(email, password) {
  const response = await fetch(
    `${API_URL}/auth/reset-password`,
    {
      method: "POST",

      headers: authHeaders({
        "Content-Type": "application/json",
      }),

      body: JSON.stringify({ email, password }),
    }
  );

  return await response.json();
}

export async function getCurrentUser(timeoutMs = 5000) {
  // Each panel keeps its own token in per-app storage. Without one the app
  // is logged out by definition: never fall back to the shared cookie, or a
  // login in the other panel would surface here.
  if (!getStoredToken()) {
    return { success: false, message: "Not authenticated", status: 401 };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${API_URL}/auth/me`,
      {
        method: "GET",
        headers: authHeaders(),
        signal: controller.signal,
      }
    );

    handleUnauthorizedResponse(response);
    const data = await response.json();

    return {
      ...data,
      status: response.status,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { success: false, message: "Request timed out", status: 408 };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}