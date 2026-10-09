// Failed-sign-in throttling for the admin login form.
//
// Two buckets, because keying on only one of them was wrong in both directions:
//
//   acct:<email>  Stops a distributed attack. Rotating IP addresses to dodge a
//                 per-IP limit gives an attacker unlimited guesses against one
//                 known account unless the account itself has a budget. This
//                 bucket is the tighter of the two.
//
//   ip:<client>   Stops one host spraying many accounts from one place, and is
//                 deliberately LOOSER than the account budget. Keying tightly on
//                 IP alone is what this module replaces: every user behind a
//                 shared address — an office, a campus, mobile data behind
//                 carrier-grade NAT — shared one budget, so twenty failures by
//                 one person locked out everybody else.
//
// The account budget is the security control; the IP budget is the spray
// control. The gap between them is what lets a shared address stay usable.
//
// Mechanics are shared with lib/giftCardGuards.js (the same shape as the OTP
// throttle in lib/otp.js); the policy is not, because a sign-in and a gift-card
// code are different threat models and must not inherit each other's numbers.
// In-memory per process, correct for this single-instance deployment.

import {
  checkGuessAllowed,
  clientKey,
  recordFailedGuess,
  clearFailedGuesses,
} from "./giftCardGuards.js";

// Two minutes. Long enough that a lockout is a real pause, short enough that a
// fat-fingered password does not cost the user a quarter of an hour.
export const LOGIN_LOCKOUT_MS = 2 * 60 * 1000;

// Failures are counted inside a rolling window; once it lapses the budget is
// returned without anyone unlocking anything.
export const LOGIN_WINDOW_MS = 10 * 60 * 1000;

// Five wrong passwords, then a two-minute pause.
//
// This is the number that actually bounds an online guessing attack, so it is
// deliberately tight. The older limiter allowed twenty attempts per client
// address; combined with the shorter lockout, five is stricter than that was —
// roughly 800 attempts/day/account rather than ~1800 — while still letting
// someone mistype a password twice and walk straight back in.
export const MAX_ACCOUNT_FAILURES = 5;

// Roughly five shared accounts' worth before the address itself is suspect.
// Deliberately higher than MAX_ACCOUNT_FAILURES — see the module note.
export const MAX_IP_FAILURES = 50;

/**
 * The per-account key.
 *
 * Case and surrounding space are normalised because users type their own address
 * inconsistently and an attacker would not type it consistently at all: without
 * this, "A@B.com", " a@b.com " and "a@B.com" would each buy a fresh budget for
 * one account, and the per-account limit would be the first thing to fall.
 */
export function accountKey(email) {
  const normalized = String(email ?? "").trim().toLowerCase();
  return normalized ? `acct:${normalized}` : null;
}

/**
 * Both keys for one attempt, either of which may be null.
 *
 * A null IP key means the client could not be identified — every such request
 * resolves to the literal "unknown", so there is nothing meaningful to bucket
 * on and, importantly, nothing to lock. The old route therefore skipped
 * throttling those requests altogether, leaving one free pass. The account key
 * still applies, which closes that without punishing every visitor behind a
 * misconfigured proxy.
 */
export function loginKeys(request, email) {
  const client = clientKey(request);
  return {
    account: accountKey(email),
    ip: client && client !== "unknown" ? `ip:${client}` : null,
  };
}

const POLICY = {
  windowMs: LOGIN_WINDOW_MS,
  lockoutMs: LOGIN_LOCKOUT_MS,
};

/** The two policies, so the account and IP budgets cannot drift apart. */
const BUCKETS = {
  account: { max: MAX_ACCOUNT_FAILURES },
  ip: { max: MAX_IP_FAILURES },
};

/**
 * Returns { ok: true }, or { ok: false, retryAfterSec, scope } naming whichever
 * bucket is locked.
 *
 * `scope` is for logging and tests only — the route sends the same sentence for
 * either, so the response cannot be used to discover whether a given account
 * exists or which limit was hit.
 */
export function checkLoginAllowed(log, keys, nowMs = Date.now()) {
  for (const scope of ["account", "ip"]) {
    const key = keys[scope];
    if (!key) continue;

    const allowed = checkGuessAllowed(log, key, nowMs, POLICY);
    if (allowed.ok === false) return { ...allowed, scope };
  }

  return { ok: true };
}

/** Count one failed sign-in against every bucket this attempt belongs to. */
export function recordLoginFailure(log, keys, nowMs = Date.now()) {
  for (const scope of ["account", "ip"]) {
    const key = keys[scope];
    if (!key) continue;

    recordFailedGuess(log, key, nowMs, { ...POLICY, ...BUCKETS[scope] });
  }
}

/** A correct password is not a guess, so both budgets come back. */
export function clearLoginFailures(log, keys) {
  for (const scope of ["account", "ip"]) {
    const key = keys[scope];
    if (!key) continue;

    clearFailedGuesses(log, key);
  }
}