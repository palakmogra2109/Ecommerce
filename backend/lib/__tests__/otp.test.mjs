import test from "node:test";
import assert from "node:assert/strict";
import {
  OTP_TTL_MS,
  MAX_OTP_ATTEMPTS,
  canonicalMobile,
  normalizeMobile,
  mobileVariants,
  generateOtp,
  hashOtp,
  verifyOtpHash,
  isOtpExpired,
  canRequestOtp,
} from "../otp.js";

test("mobile normalization strips everything but digits", () => {
  assert.equal(normalizeMobile("+91 98765 43210"), "919876543210");
  assert.equal(normalizeMobile("98765-43210"), "9876543210");
  assert.equal(normalizeMobile(null), "");
});

test("lookup variants cover raw, digits, and plus-prefixed spellings", () => {
  assert.deepEqual(mobileVariants("+91 98765 43210"), ["+91 98765 43210", "919876543210", "+919876543210"]);
  assert.deepEqual(mobileVariants("9876543210"), ["9876543210", "+9876543210"]);
});

test("generated codes are six digits", () => {
  for (let i = 0; i < 20; i++) {
    assert.match(generateOtp(), /^\d{6}$/);
  }
});

test("hash verification accepts the right code and rejects neighbours", () => {
  const hash = hashOtp("482916");
  assert.equal(verifyOtpHash("482916", hash), true);
  assert.equal(verifyOtpHash("482917", hash), false);
  assert.equal(verifyOtpHash("", hash), false);
});

test("expiry is five minutes from issue", () => {
  assert.equal(OTP_TTL_MS, 5 * 60 * 1000);
  const issued = new Date("2026-09-30T12:00:00Z").getTime();
  const expiry = new Date(issued + 60_000);
  assert.equal(isOtpExpired({ expires_at: expiry }, issued), false);
  assert.equal(isOtpExpired({ expires_at: expiry }, issued + 60_001), true);
});

test("attempt cap is five", () => {
  assert.equal(MAX_OTP_ATTEMPTS, 5);
});

test("canonical mobile keeps the picked country code", () => {
  assert.equal(canonicalMobile("+91 98765 43210"), "+919876543210");
  assert.equal(canonicalMobile("9876543210"), "9876543210");
  assert.equal(canonicalMobile(""), "");
});

test("repeat requests inside a minute are throttled", () => {
  const log = new Map();
  const now = 1_000_000;
  assert.deepEqual(canRequestOtp(log, "9876543210", now), { ok: true });
  log.set("9876543210", [now]);
  const denied = canRequestOtp(log, "9876543210", now + 30_000);
  assert.equal(denied.ok, false);
  assert.ok(denied.retryAfterSec > 0 && denied.retryAfterSec <= 60);
  assert.deepEqual(canRequestOtp(log, "9876543210", now + 61_000), { ok: true });
});

test("more than five requests an hour are refused", () => {
  const now = 1_000_000;
  const log = new Map([["9876543210", [now, now + 1, now + 2, now + 3, now + 4]]]);
  assert.equal(canRequestOtp(log, "9876543210", now + 5).ok, false);
  // Entries older than an hour no longer count.
  assert.deepEqual(canRequestOtp(log, "9876543210", now + 3_601_000), { ok: true });
});
