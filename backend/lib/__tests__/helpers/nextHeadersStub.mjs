// Stand-in for next/headers, which exists only inside a Next request context.
// The route tests drive the handlers directly, so `cookies()` and `headers()`
// answer from values the test sets on `globalThis.__requestAuth`.
//
// This stubs the *transport*, never the decision: authenticate() still verifies
// a real JWT against JWT_SECRET and still loads a real user from the database,
// so a route in these tests is denied exactly when it would be in production.

// Read lazily on every call, not captured at import time: a test that imports a
// route before assigning globalThis.__requestAuth would otherwise capture an
// empty store and every request would 401 for no visible reason.
function store() {
  return globalThis.__requestAuth || { token: null, headers: new Map() };
}

export function cookies() {
  const current = store();
  return {
    get: (name) =>
      name === "token" && current.token ? { name, value: current.token } : undefined,
  };
}

export function headers() {
  return store().headers;
}
