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