// Test-only stand-in for lib/authorization.
//
// `authenticate()` reads `next/headers()`, which only resolves inside a Next
// request, so a route file cannot be exercised from a node:test process without
// replacing that one function. Everything else stays real: the scratch database,
// the models, the claim service, the guards and the routes themselves are the
// production ones. Only "who is calling" is arranged here, which is also the one
// thing a test genuinely has to arrange — the alternative is minting JWTs and
// user rows to say the same thing more slowly.

let current = {
  ok: false,
  response: Response.json({ success: false, message: "Not authenticated" }, { status: 401 }),
};

// A signed-in shopper. `customerId: null` is the guest shape the wallet route
// has to tolerate: a real account with no customer row attached, which is what
// an older login produced.
export function signIn(user) {
  current = { ok: true, user };
}

export function signOut() {
  current = {
    ok: false,
    response: Response.json({ success: false, message: "Not authenticated" }, { status: 401 }),
  };
}

export async function authenticate() {
  return current;
}