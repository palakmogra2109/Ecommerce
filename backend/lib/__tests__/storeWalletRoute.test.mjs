import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnv } from "../../scripts/lib/env.mjs";

// The environment first, exactly as giftCardCodeModel.test.mjs does it.
await loadEnv();

// ------------------------------------------------------- the @/ path mapping
//
// Next resolves `@/*` and `@shared/*` through tsconfig paths and its bundler;
// node:test resolves neither, and it also refuses the extensionless relative
// imports the codebase is full of ("../db", "./giftCardRules"). The routes
// under test are the real files, so the same resolution is reproduced here
// rather than by copying the routes' bodies into something importable.
//
// Only ONE module is substituted: lib/authorization, whose authenticate()
// needs next/headers and therefore cannot exist outside a request. It is
// pointed at a sibling stub rather than mocked away, so the test imports the
// same module instance the route does and can arrange the caller through it.
const BACKEND_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHARED_ROOT = path.join(BACKEND_ROOT, "..", "shared");
const AUTH_STUB = new URL("./storeWalletRouteAuth.mjs", import.meta.url).href;

function asFile(candidate) {
  const direct = existsFile(candidate);
  if (direct) return direct;
  for (const suffix of [".js", ".mjs", "/index.js"]) {
    const nested = existsFile(candidate + suffix);
    if (nested) return nested;
  }
  return null;
}

function existsFile(candidate) {
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/authorization") {
      return { url: AUTH_STUB, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const file = asFile(path.join(BACKEND_ROOT, specifier.slice(2)));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    if (specifier.startsWith("@shared/")) {
      const file = asFile(path.join(SHARED_ROOT, specifier.slice("@shared/".length)));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    if (/^\.{1,2}\//.test(specifier) && context.parentURL) {
      const file = asFile(fileURLToPath(new URL(specifier, context.parentURL)));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

// ---------------------------------------------------------------- throwaway DB
//
// Same rule as every other DB-backed test here, and for a sharper reason than
// the usual one: this file calls the endpoints that CREDIT a wallet. Run against
// the live `ecommerce` database, a passing test would be a customer who came
// back with money nobody gave them. So it is created from sql/schema.sql and
// thrown at the live database from the outside.
//
// The base URL is everything up to and including the final slash, so the live
// database name is replaced rather than guessed at.
import pg from "pg";

const BASE_URL = process.env.DATABASE_URL.replace(/\/[^/]*$/, "/");
const SCRATCH_DB = "gc_walletroute";
const SCRATCH_URL = `${BASE_URL}${SCRATCH_DB}`;

// FORCE, so a previous run that died holding a connection cannot leave the
// database alive and make the next run fail for the wrong reason.
const admin = new pg.Pool({ connectionString: `${BASE_URL}postgres` });
await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
await admin.end();

// lib/db.js builds its Pool at module scope out of process.env.DATABASE_URL and
// Node caches an imported module for the life of the process, so the variable
// has to be repointed at the scratch database BEFORE anything imports it —
// which is why these are `await import()` and why the block above cannot move
// into a hook.
process.env.DATABASE_URL = SCRATCH_URL;

const scratch = new pg.Pool({ connectionString: SCRATCH_URL });
// Resolved against this file rather than process.cwd(), so the suite runs the
// same way whether npm started it from backend/ or a script did.
await scratch.query(fs.readFileSync(new URL("../../sql/schema.sql", import.meta.url), "utf8"));

const walletRoute = await import("../../app/api/store/wallet/route.js");
const previewRoute = await import("../../app/api/store/gift-cards/claim/preview/route.js");
const { signIn, signOut } = await import("./storeWalletRouteAuth.mjs");
const { GiftCardCode, CODE_STATUS } = await import("../models/giftCardCode.js");
const { Wallet } = await import("../models/wallet.js");
const { claimEligibility } = await import("../services/claimGiftCard.js");
const { MAX_GUESSES_PER_WINDOW } = await import("../giftCardGuards.js");

// ------------------------------------------------------------------- plumbing

const json = async (response) => ({ status: response.status, body: await response.json() });

// A distinct client IP per call by default: both routes throttle per client, and
// without this the tests would lock each other out and fail for the wrong
// reason. Passing one `ip` to several calls is how a shared budget — and so the
// throttle itself — is tested.
let ipSeq = 0;
const nextIp = () => `203.0.113.${(ipSeq += 1) % 250}`;

const callWallet = async (ip = nextIp()) =>
  json(
    await walletRoute.GET(
      new Request("http://localhost/api/store/wallet", {
        method: "GET",
        headers: ip ? { "x-forwarded-for": ip } : {},
      })
    )
  );

const callPreview = async (payload, ip = nextIp()) =>
  json(
    await previewRoute.POST(
      new Request("http://localhost/api/store/gift-cards/claim/preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(ip ? { "x-forwarded-for": ip } : {}),
        },
        body: JSON.stringify(payload),
      })
    )
  );

// ------------------------------------------------------------------- seeding

let customerSeq = 0;
async function seedCustomer() {
  customerSeq += 1;
  const email = `route-tester-${customerSeq}-${randomUUID()}@example.test`;
  const result = await scratch.query(
    "INSERT INTO customers (name, email) VALUES ($1, $2) RETURNING id",
    [`Route Tester ${customerSeq}`, email]
  );
  return { id: Number(result.rows[0].id), email };
}

// The legacy system's card: a gift_cards row the shopper owns.
async function seedLegacyCard(
  customerId,
  { initialAmount = 500, balance = initialAmount, status = "ACTIVE", expiresAt = null } = {}
) {
  const result = await scratch.query(
    `INSERT INTO gift_cards (customer_id, initial_amount, balance, status, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [customerId, initialAmount, balance, status, expiresAt]
  );
  return Number(result.rows[0].id);
}

// The v2 system's money: a wallet with buckets, exactly as a claim leaves them.
// `applicability` is the row-per-restriction form the claim freezes.
async function seedWallet(customerId, buckets = []) {
  const wallet = await Wallet.ensureForCustomer(customerId);
  for (const bucket of buckets) {
    await scratch.query(
      `INSERT INTO customer_wallet_buckets
         (wallet_id, currency, initial_value, remaining, applicability, expires_at)
       VALUES ($1, 'INR', $2, $3, $4::jsonb, $5)`,
      [
        wallet.id,
        bucket.initialValue ?? bucket.balance,
        bucket.balance,
        JSON.stringify(bucket.applicability || []),
        bucket.expiresAt ?? null,
      ]
    );
  }
  return wallet;
}

let templateSeq = 0;
async function seedTemplate({ initialAmount = 1000 } = {}) {
  templateSeq += 1;
  const result = await scratch.query(
    `INSERT INTO gift_cards (label, initial_amount, balance, currency, status)
     VALUES ($1, $2, $2, 'INR', 'ACTIVE') RETURNING id`,
    [`Route Template ${templateSeq}`, initialAmount]
  );
  return Number(result.rows[0].id);
}

async function setScope(templateId, rows) {
  for (const row of rows) {
    await scratch.query(
      "INSERT INTO gift_card_applicability (template_id, kind, value) VALUES ($1, $2, $3)",
      [templateId, row.kind, row.value]
    );
  }
}

let codeSeq = 0;
// issueInTx is the only thing that mints a code in production, so the tests mint
// theirs the same way. The plaintext comes back once and is never stored.
async function issueCode(templateId, { expiresAt = null } = {}) {
  codeSeq += 1;
  const plaintext = `gift-route-${String(codeSeq).padStart(4, "0")}-${randomUUID().slice(0, 6)}`;
  const client = await scratch.connect();
  try {
    await client.query("BEGIN");
    const row = await GiftCardCode.issueInTx(client, { templateId, code: plaintext, expiresAt });
    await client.query("COMMIT");
    return { ...row, plaintext };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function revokeCode(codeId) {
  const client = await scratch.connect();
  try {
    await client.query("BEGIN");
    await GiftCardCode.revokeInTx(client, { id: codeId, reason: "Reported stolen" });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function forceStatus(codeId, status) {
  await scratch.query("UPDATE gift_card_codes SET status = $1, updated_at = now() WHERE id = $2", [
    status,
    codeId,
  ]);
}

// Marks a code as claimed without crediting anybody: enough for the "already
// claimed" refusal, which is decided on the row and not on any balance.
async function stampClaim(codeId, customerId, value) {
  await scratch.query(
    `UPDATE gift_card_codes
        SET status = $1, claimed_by = $2, claimed_at = now(), claimed_value = $3, updated_at = now()
      WHERE id = $4`,
    [CODE_STATUS.REDEEMED, customerId, value, codeId]
  );
}

// Every row and every timestamp the endpoints could plausibly touch. "Writes
// nothing" is a property of the writes, not of the absence of an obvious
// statement, so this compares actual rows rather than trusting the intent.
const snapshot = async () => ({
  codes: (
    await scratch.query(
      "SELECT id, status, claimed_by, claimed_value, updated_at FROM gift_card_codes ORDER BY id"
    )
  ).rows,
  wallets: (
    await scratch.query("SELECT id, created_at, updated_at FROM customer_wallets ORDER BY id")
  ).rows,
  buckets: (
    await scratch.query(
      "SELECT id, remaining, updated_at FROM customer_wallet_buckets ORDER BY id"
    )
  ).rows,
  ledger: (await scratch.query("SELECT id FROM customer_reward_transactions ORDER BY id")).rows,
});

// ============================================== the wallet endpoint, with money

test("a customer with buckets is told about every one of them, with its scope", async () => {
  const customer = await seedCustomer();
  await seedLegacyCard(customer.id, { initialAmount: 250, balance: 250 });
  await seedWallet(customer.id, [
    { balance: 400, applicability: [{ type: "CATEGORY", value: "spices" }] },
    { balance: 600, applicability: [] },
  ]);

  signIn({ email: customer.email, customerId: customer.id });
  const { status, body } = await callWallet();

  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.v2Balance, 1000, "the two buckets together");

  assert.equal(body.buckets.length, 2);
  // Restricted first: Wallet.bucketsFor already orders that way, because money
  // from a spices-only card cannot wait behind unrestricted value.
  assert.equal(body.buckets[0].balance, 400);
  assert.equal(body.buckets[0].scopeLabel, "Category: spices");
  assert.equal(body.buckets[1].balance, 600);
  assert.equal(body.buckets[1].scopeLabel, "All products");

  assert.deepEqual(body.buckets[0].scope, {
    brands: [],
    categories: ["spices"],
    productIds: [],
    malformed: false,
  });

  assert.equal(body.redeemedCount, 2, "both buckets hold something");
  // The two names are the same array, so the list beside `cards` and the
  // wallet's own list cannot drift apart.
  assert.deepEqual(body.walletBuckets, body.buckets);

  // The legacy card is still listed, still masked, and still spendable.
  assert.equal(body.cards.length, 1);
  assert.equal(body.cardCount, 1);
  assert.equal(body.cards[0].spendable, true);
  assert.equal(body.cards[0].code_hash, undefined, "and carries no lookup hash");
});

test("a scope nobody can read is captioned as a restriction, never as free money", async () => {
  const customer = await seedCustomer();
  await seedWallet(customer.id, [
    // A row the classifier cannot place, alongside real ones. normalizeScope
    // folds an unrecognised row into `malformed` and every consumer treats that
    // as "restricted to nothing", so the caption must not read as "All products".
    { balance: 100, applicability: [{ type: "PLANET", value: "mars" }] },
    { balance: 200, applicability: [{ type: "BRAND", value: "Nila Organics" }] },
    { balance: 300, applicability: [{ type: "PRODUCT", value: "a-uuid" }] },
  ]);

  signIn({ email: customer.email, customerId: customer.id });
  const { body } = await callWallet();

  const labels = body.buckets.map((b) => b.scopeLabel);
  assert.ok(labels.includes("Unrecognised restriction"), `got ${JSON.stringify(labels)}`);
  assert.ok(labels.includes("Brand: Nila Organics"), `got ${JSON.stringify(labels)}`);
  assert.ok(labels.includes("Product: 1 item"), `got ${JSON.stringify(labels)}`);
  assert.equal(labels.includes("All products"), false, "no bucket here restricts nothing");
});

test("the headline balance is both systems, because the shopper should not care which", async () => {
  const customer = await seedCustomer();
  await seedLegacyCard(customer.id, { initialAmount: 250, balance: 250 });
  await seedWallet(customer.id, [{ balance: 400 }]);

  signIn({ email: customer.email, customerId: customer.id });
  const { body } = await callWallet();

  assert.equal(body.legacyBalance, 250);
  assert.equal(body.v2Balance, 400);
  assert.equal(body.balance, 650, "one number, not two the shopper has to add up");
});

test("an unspendable legacy card stays out of the total but stays in the list", async () => {
  const customer = await seedCustomer();
  // Expired: listed, faded in the UI, and not money.
  await seedLegacyCard(customer.id, { initialAmount: 900, balance: 900, expiresAt: "2000-01-01T00:00:00Z" });
  await seedWallet(customer.id, [{ balance: 400 }]);

  signIn({ email: customer.email, customerId: customer.id });
  const { body } = await callWallet();

  assert.equal(body.cards.length, 1, "still shown");
  assert.equal(body.cards[0].spendable, false);
  assert.equal(body.cardCount, 0);
  assert.equal(body.legacyBalance, 0);
  assert.equal(body.balance, 400, "only the live money counts");
});

test("a guest gets the legacy answer and no error, and a GET never opens a wallet", async () => {
  const customer = await seedCustomer();
  await seedLegacyCard(customer.id, { initialAmount: 120, balance: 120 });
  await seedWallet(customer.id, [{ balance: 9999 }]);

  // The wallet above belongs to somebody else; a guest is not that shopper.
  // customerId null is the older-login shape, not an unauthenticated request.
  signIn({ email: "nobody@example.test", customerId: null });
  const { status, body } = await callWallet();

  assert.equal(status, 200, "a guest is not an error");
  assert.equal(body.success, true);
  assert.equal(body.v2Balance, 0);
  assert.deepEqual(body.buckets, []);
  assert.deepEqual(body.walletBuckets, []);
  assert.equal(body.redeemedCount, 0);
  assert.equal(body.cards.length, 0, "not this customer's cards either");
  assert.equal(body.balance, 0);
});

test("a customer with nothing at all gets zeros and empty arrays, not a 500", async () => {
  const customer = await seedCustomer();

  signIn({ email: customer.email, customerId: customer.id });
  const { status, body } = await callWallet();

  assert.equal(status, 200);
  assert.equal(body.balance, 0);
  assert.equal(body.legacyBalance, 0);
  assert.equal(body.v2Balance, 0);
  assert.equal(body.redeemedCount, 0);
  assert.deepEqual(body.cards, []);
  assert.deepEqual(body.buckets, []);
  assert.deepEqual(body.walletBuckets, []);
});

test("reading the balance creates no wallet, so a page view is never what opens one", async () => {
  const customer = await seedCustomer();
  signIn({ email: customer.email, customerId: customer.id });

  const before = (
    await scratch.query("SELECT COUNT(*)::int AS n FROM customer_wallets")
  ).rows[0].n;

  await callWallet();
  await callWallet();

  const after = (
    await scratch.query("SELECT COUNT(*)::int AS n FROM customer_wallets")
  ).rows[0].n;
  assert.equal(after, before, "Wallet.ensureForCustomer must not be reachable from this GET");
});

test("an unauthenticated read is refused before anything is looked up", async () => {
  signOut();
  const { status, body } = await callWallet();
  assert.equal(status, 401);
  assert.equal(body.success, false);
});

// ============================================== the preview endpoint, read-only

test("the preview reports what a code is worth and writes nothing", async () => {
  const templateId = await seedTemplate({ initialAmount: 1000 });
  await setScope(templateId, [{ kind: "CATEGORY", value: "spices" }]);
  const issued = await issueCode(templateId, {
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const customer = await seedCustomer();
  signIn({ email: customer.email, customerId: customer.id });

  const before = await snapshot();
  const { status, body } = await callPreview({ code: issued.plaintext });
  const after = await snapshot();

  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.claimable, true);
  assert.equal(body.faceValue, 1000, "so the panel can say what it is worth before committing");
  assert.equal(body.currency, "INR");
  assert.equal(body.scopeLabel, "Category: spices", "and what the money is allowed to buy");
  assert.equal(body.reason, null);

  assert.deepEqual(after.codes, before.codes, "no code row was touched, updated_at included");
  assert.deepEqual(after.wallets, before.wallets, "no wallet was created");
  assert.deepEqual(after.buckets, before.buckets);
  assert.deepEqual(after.ledger, before.ledger);
});

test("the preview never echoes the submitted code, whatever the verdict", async () => {
  const templateId = await seedTemplate({ initialAmount: 1000 });
  const issued = await issueCode(templateId);
  const unknown = `GIFT-ZZZZ-ZZZZ-${randomUUID().slice(0, 4)}`;
  const customer = await seedCustomer();
  signIn({ email: customer.email, customerId: customer.id });

  for (const code of [issued.plaintext, unknown]) {
    const { status, body } = await callPreview({ code });
    assert.equal(status, 200);
    const text = JSON.stringify(body);
    assert.equal(text.includes(code), false, `plaintext echoed: ${code}`);
    assert.equal(text.includes(code.toUpperCase()), false, "echoed in another case");
    assert.equal(text.includes(code.replace(/-/g, "")), false, "echoed without separators");
    // The full code is the one thing this endpoint must never be a channel for.
    assert.equal("code" in body, false, "the response has no code field at all");
    assert.equal(body.code_last4, undefined);
  }
});

test("the preview agrees with claimEligibility, and therefore with the claim", async () => {
  const templateId = await seedTemplate({ initialAmount: 900 });
  const customer = await seedCustomer();
  signIn({ email: customer.email, customerId: customer.id });

  const valid = await issueCode(templateId);
  const claimed = await issueCode(templateId);
  await stampClaim(claimed.id, customer.id, 900);
  const revoked = await issueCode(templateId);
  await revokeCode(revoked.id);
  const expired = await issueCode(templateId, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  const unpaid = await issueCode(templateId);
  await forceStatus(unpaid.id, CODE_STATUS.PENDING_PAYMENT);
  const unsent = await issueCode(templateId);
  await forceStatus(unsent.id, CODE_STATUS.SCHEDULED);

  const cases = [
    { label: "valid", code: valid.plaintext, expect: null },
    { label: "already claimed", code: claimed.plaintext, expect: "ALREADY_CLAIMED" },
    { label: "revoked", code: revoked.plaintext, expect: "REVOKED" },
    { label: "expired", code: expired.plaintext, expect: "EXPIRED" },
    { label: "not paid", code: unpaid.plaintext, expect: "NOT_PAID" },
    { label: "not yet delivered", code: unsent.plaintext, expect: "NOT_YET_DELIVERED" },
    { label: "unknown", code: "GIFT-ZZZZ-ZZZZ", expect: "NOT_FOUND" },
  ];

  for (const item of cases) {
    const { status, body } = await callPreview({ code: item.code });

    // The verdict, taken straight off the predicate on the same row. If the two
    // can disagree the panel would promise something the claim then refuses.
    const row = item.expect === "NOT_FOUND" ? null : await GiftCardCode.findByPlaintext(item.code);
    const verdict = claimEligibility(row);

    assert.equal(status, 200, `${item.label}: a preview that answers is not an HTTP error`);
    assert.equal(body.claimable, verdict.ok, `${item.label}: claimable matches the predicate`);
    assert.equal(body.reason, verdict.ok ? null : verdict.code, `${item.label}: reason matches`);
    assert.equal(typeof body.message, "string", `${item.label}: always something to display`);
    assert.ok(body.message.length > 0);
    if (item.expect === "NOT_FOUND") {
      assert.equal(
        body.message,
        "We could not find a gift card for that code.",
        "NOT_FOUND says only that nothing was found, or this endpoint is an oracle"
      );
    }
  }
});

test("a code the preview refuses reports no face value and no scope", async () => {
  const templateId = await seedTemplate({ initialAmount: 900 });
  await setScope(templateId, [{ kind: "BRAND", value: "Nila Organics" }]);
  const issued = await issueCode(templateId);
  await forceStatus(issued.id, CODE_STATUS.PENDING_PAYMENT);
  const customer = await seedCustomer();
  signIn({ email: customer.email, customerId: customer.id });

  const { body } = await callPreview({ code: issued.plaintext });

  assert.equal(body.claimable, false);
  assert.equal(body.reason, "NOT_PAID");
  assert.equal(body.faceValue, null, "no figure for a code they cannot use");
  assert.equal(body.currency, null);
  assert.equal(body.scopeLabel, null, "and no more detail about it than the refusal itself");
});

test("an empty submission is a malformed request, not a wrong code", async () => {
  const customer = await seedCustomer();
  signIn({ email: customer.email, customerId: customer.id });

  for (const body of [{}, { code: "" }, { code: "   " }, { code: 42 }]) {
    const { status, body: payload } = await callPreview(body);
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(payload.success, false);
    assert.equal(payload.reason, undefined, "and no verdict, so no lookup happened");
  }
});

test("previewing wrong codes is throttled, or it is an unlimited oracle", async () => {
  const customer = await seedCustomer();
  signIn({ email: customer.email, customerId: customer.id });
  // One shared client IP, which is what makes the budget shared.
  const ip = nextIp();

  for (let i = 0; i < MAX_GUESSES_PER_WINDOW; i += 1) {
    const { status } = await callPreview({ code: `GIFT-WRONG-${randomUUID().slice(0, 4)}` }, ip);
    assert.equal(status, 200, `guess ${i + 1} is answered, then refused`);
  }

  const locked = await callPreview({ code: "GIFT-WRONG-ZZZZ" }, ip);
  assert.equal(locked.status, 429, "the next one is a 429 rather than an answer");
  assert.match(locked.body.message, /too many/i);

  // And the answer to a REAL code is refused too, from this address, which is
  // what makes the throttle a lockout rather than a suggestion.
  const templateId = await seedTemplate({ initialAmount: 100 });
  const real = await issueCode(templateId);
  const refusedReal = await callPreview({ code: real.plaintext }, ip);
  assert.equal(refusedReal.status, 429);

  // A different client is unaffected: the budget is per client, not global.
  const other = await callPreview({ code: real.plaintext }, nextIp());
  assert.equal(other.status, 200);
  assert.equal(other.body.claimable, true);
});

test("asking about your own card twice does not lock you out", async () => {
  const templateId = await seedTemplate({ initialAmount: 250 });
  const issued = await issueCode(templateId);
  const customer = await seedCustomer();
  signIn({ email: customer.email, customerId: customer.id });
  const ip = nextIp();

  // Two wrong guesses, then the right one: a mistyped card must not spend the
  // budget that the successful lookup then clears.
  await callPreview({ code: "GIFT-NOPE-ZZZZ" }, ip);
  await callPreview({ code: "GIFT-NOPE-ZZZZ" }, ip);
  const { status, body } = await callPreview({ code: issued.plaintext }, ip);
  assert.equal(status, 200);
  assert.equal(body.claimable, true);
});

test("an unauthenticated preview is refused before anything is looked up", async () => {
  signOut();
  const { status, body } = await callPreview({ code: "GIFT-ZZZZ-ZZZZ" });
  assert.equal(status, 401);
  assert.equal(body.success, false);
  assert.equal(body.claimable, undefined, "no verdict without a session");
});