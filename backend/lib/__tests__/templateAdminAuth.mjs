// Test-only stand-in for lib/authorization.
//
// `authorize()` reads next/headers(), which only resolves inside a Next request,
// so a route file cannot be exercised from a node:test process without replacing
// that one function. Everything else stays real: the scratch database, the models,
// the purchase service, the guards and the routes themselves are the production
// ones. Only "who is calling, and what are they allowed" is arranged here — which
// is also the one thing a test genuinely has to arrange, the alternative being
// minting JWTs and user rows to say the same thing more slowly.
//
// It records what it was asked for, because "which permission guards this route"
// is a real assertion: a template write that only checked VIEW would pass every
// other test in this file and be a privilege escalation in production.

// A FRESH Response each time. A stored one would be handed out already consumed
// on the second call — Response bodies are single-use — which shows up as a
// confusing "Body is unusable" TypeError inside whichever test called it twice.
const denied = (message, status) => () =>
  Response.json({ success: false, message }, { status });

let signedIn = null;
let granted = new Set();
let asked = [];

/**
 * Sign an admin in.
 *
 * `permissions` defaults to super-admin, which is what lib/authorization's
 * hasPermission answers for that role whatever it is asked. Pass an explicit list
 * to test a 403 — `signIn(user, { permissions: ["gift_cards.view"] })` is an admin
 * who may read the catalogue and change nothing.
 */
export function signIn(user, { permissions = ["__any__"] } = {}) {
  signedIn = user;
  granted = new Set(permissions);
  asked = [];
}

export function signOut() {
  signedIn = null;
  granted = new Set();
  asked = [];
}

export async function authorize(permissionSlug) {
  asked.push(permissionSlug);
  if (!signedIn) return { ok: false, response: denied("Not authenticated", 401)() };
  if (!granted.has(permissionSlug) && !granted.has("__any__")) {
    return {
      ok: false,
      response: denied("You do not have permission to perform this action", 403)(),
    };
  }
  return { ok: true, user: signedIn };
}

/** The permission slugs the routes under test have asked for, in order. */
export function permissionsAsked() {
  return asked;
}