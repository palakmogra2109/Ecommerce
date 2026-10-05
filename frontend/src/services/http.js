const TOKEN_KEY = "auth_token";

export function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function storeToken(token) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Storage unavailable (private mode): auth still works in-memory.
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore storage errors.
  }
}

// Merges an Authorization header onto the caller's headers when a per-app
// token exists. Returns the caller headers untouched otherwise.
export function authHeaders(extra = {}) {
  const token = getStoredToken();

  if (!token) {
    return extra;
  }

  return {
    ...extra,
    Authorization: `Bearer ${token}`,
  };
}
// Fires when any request comes back 401, so the app can drop the dead session
// instead of waiting for a reload.
const unauthorizedHandlers = new Set();

export function onUnauthorized(handler) {
  unauthorizedHandlers.add(handler);
  return () => unauthorizedHandlers.delete(handler);
}

/**
 * Call after a response that was 401. The server means it for one of two
 * reasons and the app must treat them the same: the token expired, or the
 * account was deactivated while the session was live. Both mean the token is
 * finished with.
 *
 * A deactivated user previously stayed signed in until the token's own 7 days
 * ran out, because nothing cleared it mid-session — only a page reload did, and
 * even that went through /api/auth/me, which was not checking status at all.
 */
export function handleUnauthorizedResponse(response) {
  if (response?.status !== 401) return false;
  clearToken();
  unauthorizedHandlers.forEach((handler) => {
    try {
      handler();
    } catch {
      // A failing subscriber must not stop the others.
    }
  });
  return true;
}
