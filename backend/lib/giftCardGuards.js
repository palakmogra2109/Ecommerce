// Rejection tracking for gift-card code guessing.
//
// Codes are high entropy, so a real brute force is impractical; this exists to
// stop cheap scripted spraying and to keep the code path from being an
// unlimited oracle. In-memory per process, matching the OTP throttle in
// lib/otp.js and correct for this single-instance deployment.

export const MAX_GUESSES_PER_WINDOW = 20;
export const GUESS_WINDOW_MS = 10 * 60 * 1000;
export const LOCKOUT_MS = 15 * 60 * 1000;

export function clientKey(request) {
  const headers = request?.headers;
  const forwarded = headers?.get?.("x-forwarded-for");
  if (forwarded) {
    // Left-most entry is the original client.
    return forwarded.split(",")[0].trim();
  }
  return headers?.get?.("x-real-ip") || "unknown";
}

// Returns { ok: true } or { ok: false, retryAfterSec }.
export function checkGuessAllowed(log, key, nowMs = Date.now()) {
  const entry = log.get(key);
  if (!entry) return { ok: true };

  if (entry.lockedUntil && entry.lockedUntil > nowMs) {
    return { ok: false, retryAfterSec: Math.ceil((entry.lockedUntil - nowMs) / 1000) };
  }

  // Window elapsed (and any lockout expired): start counting again.
  if (nowMs - (entry.windowStart || 0) > GUESS_WINDOW_MS) {
    log.delete(key);
    return { ok: true };
  }

  return { ok: true };
}

// Call only after a *failed* guess, so a shopper who types their own valid
// code once is never penalised.
export function recordFailedGuess(log, key, nowMs = Date.now()) {
  const entry = log.get(key) || { count: 0, windowStart: nowMs };
  if (nowMs - entry.windowStart > GUESS_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = nowMs;
  }
  entry.count += 1;
  if (entry.count >= MAX_GUESSES_PER_WINDOW) {
    entry.lockedUntil = nowMs + LOCKOUT_MS;
  }
  log.set(key, entry);
  return entry;
}

export function clearFailedGuesses(log, key) {
  log.delete(key);
}
