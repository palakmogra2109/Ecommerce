import test from "node:test";
import assert from "node:assert/strict";
import {
  generateCode,
  hashCode,
  normalizeCode,
  codeLast4,
  looksLikeCode,
  codeHashesMatch,
} from "../giftCardCodeGen.js";

test("generated codes match the documented shape", () => {
  for (let i = 0; i < 200; i++) {
    assert.match(generateCode(), /^GIFT-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  }
});

test("generated codes do not repeat across a large sample", () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) seen.add(generateCode());
  assert.equal(seen.size, 5000);
});

test("normalization is case and whitespace insensitive", () => {
  assert.equal(normalizeCode("  gift 8k4p 92xm "), "GIFT-8K4P-92XM");
  assert.equal(normalizeCode("gift-8k4p-92xm"), "GIFT-8K4P-92XM");
});

test("hashing is stable, lowercase hex, and case insensitive", () => {
  const a = hashCode("GIFT-8K4P-92XM");
  assert.equal(a, hashCode("gift-8k4p-92xm"));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("last4 ignores separators", () => {
  assert.equal(codeLast4("GIFT-8K4P-92XM"), "92XM");
});

test("code detection rejects obvious non-codes", () => {
  assert.equal(looksLikeCode("GIFT-8K4P-92XM"), true);
  assert.equal(looksLikeCode("nope"), false);
  assert.equal(looksLikeCode(""), false);
  assert.equal(looksLikeCode("123"), false);
});

test("code hash comparison is true only for equal hashes", () => {
  const h = hashCode("GIFT-8K4P-92XM");
  assert.equal(codeHashesMatch(h, h), true);
  assert.equal(codeHashesMatch(h, hashCode("GIFT-0000-0000")), false);
});

test("code hash comparison handles missing and mismatched lengths safely", () => {
  assert.equal(codeHashesMatch(null, "abc"), false);
  assert.equal(codeHashesMatch("abc", null), false);
  assert.equal(codeHashesMatch("abc", "abcd"), false);
  assert.equal(codeHashesMatch("abc", "abc"), true);
});
