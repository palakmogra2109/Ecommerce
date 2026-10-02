import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Ambiguous glyphs are removed: 0/O and 1/I are excluded so a code read aloud
// or retyped has one spelling. L is kept — it is unambiguous once 1 is gone.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^GIFT-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function normalizeCode(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .toUpperCase();
}

export function hashCode(code) {
  return createHash("sha256").update(normalizeCode(code)).digest("hex");
}

export function codeLast4(code) {
  return normalizeCode(code).replace(/[^A-Z0-9]/g, "").slice(-4);
}

export function looksLikeCode(value) {
  return CODE_RE.test(normalizeCode(value));
}

export function generateCode() {
  // 8 bytes over a 32-character alphabet: 256 % 32 === 0, so every value maps
  // to exactly one character and the distribution is already uniform.
  const bytes = randomBytes(8);
  let tail = "";
  for (let i = 0; i < 8; i++) tail += ALPHABET[bytes[i] % ALPHABET.length];
  return `GIFT-${tail.slice(0, 4)}-${tail.slice(4)}`;
}

// Constant-time compare of two code hashes, for any path that verifies a
// supplied code against a stored one outside a database lookup.
export function codeHashesMatch(a, b) {
  if (!a || !b) return false;
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
