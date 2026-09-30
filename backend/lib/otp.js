import { createHash, randomInt, timingSafeEqual } from "node:crypto";

// One-time passcodes for storefront mobile login.
//
// Delivery is demo-mode: the issued code is returned in the request response
// (and server log) until an SMS sender is plugged in. The sender seam is the
// `deliverOtp` export — replace its body with a provider call (MSG91,
// Twilio, Fast2SMS, …) and stop returning `demoOtp` from the route.
export const OTP_TTL_MS = 5 * 60 * 1000;
export const MAX_OTP_ATTEMPTS = 5;
const MIN_REQUEST_INTERVAL_MS = 60 * 1000;
const MAX_REQUESTS_PER_HOUR = 5;

export function normalizeMobile(input) {
  return String(input ?? "").replace(/\D/g, "");
}

// Canonical stored form: E.164 (`+<digits>`) when a country code was picked,
// plain digits otherwise. Lookups always use mobileVariants, so every stored
// spelling stays findable.
export function canonicalMobile(input) {
  const digits = normalizeMobile(input);
  if (!digits) return "";
  return String(input ?? "").trim().startsWith("+") ? `+${digits}` : digits;
}

// Existing rows may store the number raw ("+91 98…"), digits-only, or with a
// plus prefix. Look all three up so an OTP login finds the same account the
// shopper registered with, whatever spelling was stored.
export function mobileVariants(input) {
  const raw = String(input ?? "").trim();
  const digits = normalizeMobile(input);
  return [...new Set([raw, digits, `+${digits}`])].filter((v) => v && v !== "+");
}

export function generateOtp() {
  return String(randomInt(100000, 1000000));
}

export function hashOtp(code) {
  return createHash("sha256").update(String(code)).digest("hex");
}

export function verifyOtpHash(code, hash) {
  const a = Buffer.from(String(code ?? ""));
  const b = Buffer.from(String(hash ?? ""), "hex");
  if (a.length === 0 || b.length !== 32) return false;
  // Compare hashes, not the raw code, so length never leaks through timing.
  const ah = createHash("sha256").update(a).digest();
  return ah.length === b.length && timingSafeEqual(ah, b);
}

export function isOtpExpired(row, nowMs = Date.now()) {
  return new Date(row.expires_at).getTime() <= nowMs;
}

// In-memory request throttle (per-process, like the geocode throttle —
// correct for this single-instance deployment). `log` maps identifier to an
// array of epoch-ms request times and is injectable for tests.
export function canRequestOtp(log, identifier, nowMs = Date.now()) {
  const times = (log.get(identifier) || []).filter((t) => nowMs - t < 3_600_000);
  log.set(identifier, times);
  const recent = times.filter((t) => nowMs - t < MIN_REQUEST_INTERVAL_MS);
  if (recent.length > 0) {
    const retryAfterSec = Math.ceil((MIN_REQUEST_INTERVAL_MS - (nowMs - recent[recent.length - 1])) / 1000);
    return { ok: false, retryAfterSec };
  }
  if (times.length >= MAX_REQUESTS_PER_HOUR) {
    return { ok: false, retryAfterSec: 3600 };
  }
  return { ok: true };
}

export function recordOtpRequest(log, identifier, nowMs = Date.now()) {
  const times = log.get(identifier) || [];
  times.push(nowMs);
  log.set(identifier, times);
}

// Demo-mode sender: logs the code and reports it back. Swap this body for a
// real SMS provider call; the routes already treat the return as opaque.
export async function deliverOtp(identifier, code) {
  console.log(`[otp-demo] code for ${identifier}: ${code}`);
  return { delivered: true, demoOtp: code };
}
