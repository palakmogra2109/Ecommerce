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
// The same mapping storeWalletRoute.test.mjs establishes: Next resolves `@/*`
// and `@shared/*` and extensionless relative specifiers, node:test resolves
// none of them. The routes under test are the real files, so the resolution is
// reproduced rather than the routes being copied into something importable.
const BACKEND_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHARED_ROOT = path.join(BACKEND_ROOT, "..", "shared");
const SHARED_CONSTANTS = pathToFileURL(path.join(SHARED_ROOT, "constants.js")).href;

function asFile(candidate) {
  if (existsFile(candidate)) return candidate;
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
  // shared/constants.js is ESM source with no package.json beside it, so Node
  // would read it as CommonJS and refuse the named export the order route takes
  // ORDER_STATUS from. The bundler has never had that problem; this is the same
  // fix, applied at load time, so the file under test is still the real one.
  load(url, context, nextLoad) {
    if (url === SHARED_CONSTANTS) {
      return { format: "module", source: fs.readFileSync(new URL(url), "utf8"), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// ---------------------------------------------------------------- throwaway DB
//
// Same rule as every other DB-backed test here, and for a sharper reason than
// the usual one: this file moves real money — it debits buckets, refunds them and
// fires two simultaneous checkouts at the same balance. Run against the live
// `ecommerce` database, a passing test would be a customer who came back short.
//
// The base URL is everything up to and including the final slash, so the live
// database name is replaced rather than guessed at.
import pg from "pg";

const BASE_URL = process.env.DATABASE_URL.replace(/\/[^/]*$/, "/");
const SCRATCH_DB = "gc_spendtest";
const SCRATCH_URL = `${BASE_URL}${SCRATCH_DB}`;

// FORCE, so a previous run that died holding a connection cannot leave the
// database alive and make the next run fail for the wrong reason.
const admin = new pg.Pool({ connectionString: `${BASE_URL}postgres` });
await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
await admin.end();

// lib/db.js builds its Pool at module scope out of process.env.DATABASE_URL and
// Node caches an imported module for the life of the process, so the variable
// has to be repointed BEFORE anything that reaches db.js is imported. That is why
// every import below is `await import()` — including the pure functions, which
// reach db.js only through lib/models/wallet.js.
process.env.DATABASE_URL = SCRATCH_URL;

const scratch = new pg.Pool({ connectionString: SCRATCH_URL });
await scratch.query(fs.readFileSync(new URL("../../sql/schema.sql", import.meta.url), "utf8"));

const { Wallet } = await import("../models/wallet.js");
const { round2 } = await import("../giftCardApplicability.js");
const { toAllocatorBuckets, planWalletSpend, spendGiftCardBalanceInTx, refundWalletSpendInTx, walletAllocationsForOrder } =
  await import("../giftCardSpend.js");
const { reverseGiftRedemption } = await import("../giftCardRefunds.js");
const quoteRoute = await import("../../app/api/store/checkout/quote/route.js");
const orderRoute = await import("../../app/api/orders/store/route.js");
const modelPool = (await import("../db.js")).default;

// ----------------------------------------------------------------- plumbing

// Everything runs in its own transaction on its own connection, so a refused
// debit or a lost race is rolled back here and never reaches the next test.
async function inTx(fn) {
  return withClient(async (client) => {
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
}

async function withClient(fn) {
  const client = await scratch.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

const json = async (response) => ({ status: response.status, body: await response.json() });

const callQuote = async (payload) =>
  json(
    await quoteRoute.POST(
      new Request("http://localhost/api/store/checkout/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
    )
  );

const callOrder = async (payload) =>
  json(
    await orderRoute.POST(
      new Request("http://localhost/api/orders/store", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
    )
  );

// A gate that holds `count` callers at one point until all of them have
// arrived. Without it a concurrency test proves nothing: whichever transaction
// happens to run first wins and the other simply sees a settled balance. This is
// how the two are made to read the SAME remainder before either writes it, which
// is the only situation the row lock exists for.
function rendezvous(count) {
  let arrived = 0;
  let open = null;
  const gate = new Promise((resolve) => {
    open = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived >= count) open();
    await gate;
  };
}

// ----------------------------------------------------------------- seeding

let seq = 0;
const nextSeq = () => (seq += 1);

async function seedCustomer() {
  const n = nextSeq();
  const result = await scratch.query(
    "INSERT INTO customers (name, email) VALUES ($1, $2) RETURNING id, email",
    [`Spend Tester ${n}`, `spend-tester-${n}-${randomUUID()}@example.test`]
  );
  return { id: Number(result.rows[0].id), email: result.rows[0].email };
}

// A bucket created directly, which is the shape a claim leaves: initial_value set,
// remaining holding the money, applicability frozen as [{ type, value }] rows.
async function seedBucket(walletId, { initialValue, remaining = initialValue, applicability = [], expiresAt = null }) {
  const result = await scratch.query(
    `INSERT INTO customer_wallet_buckets
       (wallet_id, currency, initial_value, remaining, applicability, expires_at)
     VALUES ($1, 'INR', $2, $3, $4::jsonb, $5) RETURNING id`,
    [walletId, initialValue, remaining, JSON.stringify(applicability), expiresAt]
  );
  return Number(result.rows[0].id);
}

async function seedWallet(customerId, buckets = []) {
  const wallet = await Wallet.ensureForCustomer(customerId);
  const ids = [];
  for (const bucket of buckets) ids.push(await seedBucket(wallet.id, bucket));
  return { walletId: wallet.id, bucketIds: ids };
}

async function seedBrand(name) {
  const n = nextSeq();
  const result = await scratch.query(
    "INSERT INTO brands (name, slug) VALUES ($1, $2) RETURNING id",
    [name, `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${n}`]
  );
  return Number(result.rows[0].id);
}

async function seedCategory(name) {
  const n = nextSeq();
  const result = await scratch.query(
    "INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id",
    [name, `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${n}`]
  );
  return Number(result.rows[0].id);
}

async function seedProduct({ name, price, brandId = null, categoryId = null, stock = 100 }) {
  const n = nextSeq();
  const result = await scratch.query(
    `INSERT INTO products (name, slug, sku, price, stock, brand_id, category_id, status, inventory_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', 'SIMPLE') RETURNING id, uuid`,
    [name, `spend-product-${n}`, `SKU-${n}`, price, stock, brandId, categoryId]
  );
  return { id: Number(result.rows[0].id), uuid: result.rows[0].uuid };
}

// A product line as the allocator reads it: the server-priced unit, how many,
// and the brand/category/product a card's scope is checked against. `uuid` is
// what a scope's PRODUCT value is stored as.
async function seedLine({ name, price, brand, category, quantity = 1 }) {
  const brandId = await seedBrand(brand);
  const categoryId = await seedCategory(category);
  const product = await seedProduct({ name, price, brandId, categoryId });
  return {
    product_uuid: product.uuid,
    quantity,
    unitPrice: price,
    brand,
    category: category.toLowerCase(),
    request: { product_uuid: product.uuid, quantity },
  };
}

const bucketRemaining = async (bucketId) =>
  Number(
    (await scratch.query("SELECT remaining FROM customer_wallet_buckets WHERE id = $1", [bucketId]))
      .rows[0].remaining
  );

const debitsFor = async (orderUuid) =>
  (
    await scratch.query(
      `SELECT bucket_id, amount, balance_after, order_uuid FROM customer_reward_transactions
        WHERE type = 'DEBIT' AND order_uuid = $1::uuid ORDER BY id`,
      [orderUuid]
    )
  ).rows.map((row) => ({
    bucketId: Number(row.bucket_id),
    amount: Number(row.amount),
    balanceAfter: Number(row.balance_after),
  }));

// Scoped to one wallet: the suite shares one scratch database, so an unscoped
// count would be counting every other test's money too.
const ledgerForWallet = async (customerId, type) => {
  const wallet = await Wallet.findByCustomer(customerId);
  return (
    await scratch.query(
      `SELECT amount, balance_after FROM customer_reward_transactions
        WHERE type = $2 AND wallet_id = $1 ORDER BY id`,
      [wallet.id, type]
    )
  ).rows.map((row) => ({ amount: Number(row.amount), balanceAfter: Number(row.balance_after) }));
};

const debitsForWallet = (customerId) => ledgerForWallet(customerId, "DEBIT");
const refundsForWallet = (customerId) => ledgerForWallet(customerId, "REFUND");

const orderRow = async (uuid) =>
  (await scratch.query("SELECT uuid, subtotal, discount, total, gift_amount FROM orders WHERE uuid = $1", [uuid]))
    .rows[0];

// Every row the quote or the order could plausibly touch, with its timestamps.
// "Writes nothing" is a property of the writes, not of the absence of an obvious
// statement, so this compares rows rather than trusting the intent.
const moneySnapshot = async () => ({
  wallets: (await scratch.query("SELECT * FROM customer_wallets ORDER BY id")).rows,
  buckets: (await scratch.query("SELECT * FROM customer_wallet_buckets ORDER BY id")).rows,
  ledger: (await scratch.query("SELECT * FROM customer_reward_transactions ORDER BY id")).rows,
  orders: (await scratch.query("SELECT uuid, total FROM orders ORDER BY id")).rows,
  legacy: (await scratch.query("SELECT * FROM gift_card_transactions ORDER BY id")).rows,
  items: (await scratch.query("SELECT id, order_id, price, quantity FROM order_items ORDER BY id")).rows,
  stock: (await scratch.query("SELECT id, stock FROM products ORDER BY id")).rows,
});

/** A Nike-restricted balance and a free one, plus a mixed basket. */
async function mixedFixture() {
  const customer = await seedCustomer();
  const nike = await seedLine({ name: "Runner", price: 300, brand: "Nike", category: "Footwear" });
  const adidas = await seedLine({ name: "Trainer", price: 200, brand: "Adidas", category: "Footwear" });
  const { bucketIds } = await seedWallet(customer.id, [
    { initialValue: 300, applicability: [{ type: "BRAND", value: "Nike" }] },
    { initialValue: 600, applicability: [] },
  ]);
  return {
    customer,
    nikeBucket: bucketIds[0],
    freeBucket: bucketIds[1],
    // Restricted first, which is bucketsFor's ordering: a restricted balance that
    // will age out is spent before one that will not.
    lines: [nike, adidas],
    basketValue: 500,
  };
}

// ================================================ pure: the shape bridge

test("toAllocatorBuckets maps remaining -> amount and applicability -> scope", () => {
  const mapped = toAllocatorBuckets([
    {
      id: "9001",
      codeId: 41,
      remaining: "300.50",
      initialValue: 500,
      applicability: [{ type: "BRAND", value: "Nike" }, { type: "CATEGORY", value: "spices" }],
      expiresAt: null,
    },
  ]);

  // Asserted on the values, not on the shape: the failure this mapping exists to
  // prevent is a wallet that covers nothing, and nothing about the returned keys
  // would reveal it.
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].amount, 300.5, "remaining became amount");
  assert.equal(mapped[0].id, 9001);
  assert.deepEqual(mapped[0].scope, { brands: ["Nike"], categories: ["spices"], productIds: [], malformed: false });

  // The mapping is not decoration. Reading `amount` off the wallet's own field
  // name yields zero buckets, which is the bug this file exists to prevent.
  const wrong = [{ id: mapped[0].id, amount: 0, scope: mapped[0].scope }];
  assert.equal(planWalletSpend({ buckets: wrong, lineItems: [{ unitPrice: 300.5, quantity: 1 }], amount: 300.5 }).covered, 0);
  assert.equal(planWalletSpend({ buckets: [{ id: 1, remaining: 300.5, applicability: [] }], lineItems: [{ unitPrice: 300.5, quantity: 1 }], amount: 300.5 }).covered, 300.5);
});

test("a scope nobody can read stays restricted once it has been through normalizeScope twice", () => {
  // The trap: normalizeScope does not trust a `malformed` flag it is handed, and
  // recomputing from an already-folded object sees only the three known keys — so
  // folding a malformed scope twice reads as UNRESTRICTED. Restricted money that
  // widens is the one failure this whole layer is built to prevent.
  const bucket = { id: 7, remaining: 500, applicability: [{ type: "MYSTERY", value: "x" }] };
  const plan = planWalletSpend({ buckets: [bucket], lineItems: [{ unitPrice: 500, quantity: 1 }], amount: 500 });
  assert.equal(plan.covered, 0);
  assert.equal(plan.shortfall, 500);
  assert.equal(plan.breakdown[0].restricted, true);
  assert.equal(plan.breakdown[0].scopeLabel, "Unrecognised restriction");

  // And the raw form survives the allocator's own folding.
  assert.equal(planWalletSpend({ buckets: [{ id: 7, remaining: 500, applicability: toAllocatorBuckets([bucket])[0].scope }], lineItems: [{ unitPrice: 500, quantity: 1 }], amount: 500 }).covered, 0);
});

test("an unrestricted bucket covers a whole basket", () => {
  const plan = planWalletSpend({
    buckets: [{ id: 1, codeId: 5, remaining: 1000, applicability: [] }],
    lineItems: [{ unitPrice: 250, quantity: 2, brand: "Nike" }],
    amount: 500,
  });
  assert.deepEqual(plan.allocations, [{ bucketId: 1, amount: 500 }]);
  assert.equal(plan.covered, 500);
  assert.equal(plan.shortfall, 0);
  assert.equal(plan.fullyCovered, true);
});

test("a restricted bucket is refused an ineligible basket", () => {
  const plan = planWalletSpend({
    buckets: [{ id: 1, codeId: 5, remaining: 900, applicability: [{ type: "BRAND", value: "Nike" }] }],
    lineItems: [{ unitPrice: 400, quantity: 1, brand: "Adidas", category: "footwear" }],
    amount: 400,
  });
  assert.deepEqual(plan.allocations, []);
  assert.equal(plan.covered, 0);
  assert.equal(plan.shortfall, 400);
  assert.equal(plan.fullyCovered, false);
  assert.equal(plan.breakdown[0].applied, false);
  assert.match(plan.breakdown[0].reason, /scope/i);
});

test("a restricted bucket is capped at the eligible portion of a mixed basket", () => {
  const plan = planWalletSpend({
    buckets: [{ id: 1, remaining: 900, applicability: [{ type: "BRAND", value: "Nike" }] }],
    lineItems: [
      { unitPrice: 300, quantity: 1, brand: "Nike", category: "apparel" },
      { unitPrice: 200, quantity: 1, brand: "Adidas", category: "apparel" },
    ],
    amount: 500,
  });
  // Only the ₹300 Nike line is payable; the ₹200 Adidas line is left alone.
  assert.deepEqual(plan.allocations, [{ bucketId: 1, amount: 300 }]);
  assert.equal(plan.covered, 300);
  assert.equal(plan.shortfall, 200);
});

test("two restricted buckets cannot re-spend the same paise", () => {
  const plan = planWalletSpend({
    buckets: [
      { id: 1, remaining: 400, applicability: [{ type: "BRAND", value: "Nike" }] },
      { id: 2, remaining: 400, applicability: [{ type: "BRAND", value: "Nike" }] },
    ],
    // The cart is worth ₹500 and ₹800 is asked for. Both cards are Nike and both
    // hold ₹400, so the only question is whether the second one re-reads the same
    // ₹500 of Nike line the first already spent.
    lineItems: [{ unitPrice: 500, quantity: 1, brand: "Nike" }],
    amount: 800,
  });
  // 400 then the remaining 100 of the line. 800 would mean the same Nike paise
  // paid twice.
  assert.deepEqual(plan.allocations, [{ bucketId: 1, amount: 400 }, { bucketId: 2, amount: 100 }]);
  assert.equal(plan.covered, 500);
  assert.equal(plan.shortfall, 300);
});

test("restricted and unrestricted together cover a mixed basket exactly once", () => {
  const plan = planWalletSpend({
    // Wallet order: restricted first, which is what bucketsFor returns.
    buckets: [
      { id: 1, remaining: 400, applicability: [{ type: "BRAND", value: "Nike" }] },
      { id: 2, remaining: 900, applicability: [] },
    ],
    lineItems: [
      { unitPrice: 300, quantity: 1, brand: "Nike", category: "footwear" },
      { unitPrice: 200, quantity: 1, brand: "Adidas", category: "footwear" },
    ],
    amount: 500,
  });
  // The restricted card pays the ₹300 it is allowed to pay, and only then does
  // the free balance cover what is left. 300 + 200, and not 300 twice.
  assert.deepEqual(plan.allocations, [{ bucketId: 1, amount: 300 }, { bucketId: 2, amount: 200 }]);
  assert.equal(plan.covered, 500);
  assert.equal(plan.shortfall, 0);
  assert.equal(plan.fullyCovered, true);
});

test("breakdown names which bucket funded which amount, and why the others did not", () => {
  const plan = planWalletSpend({
    buckets: [
      { id: 11, codeId: 91, remaining: 1000, applicability: [] },
      { id: 12, codeId: 92, remaining: 300, applicability: [{ type: "CATEGORY", value: "spices" }] },
    ],
    lineItems: [{ unitPrice: 400, quantity: 1, brand: "Nike", category: "footwear" }],
    amount: 400,
  });

  assert.equal(plan.breakdown.length, 2);
  const [free, restricted] = plan.breakdown;

  assert.equal(free.bucketId, 11);
  assert.equal(free.codeId, 91);
  assert.equal(free.amount, 400);
  assert.equal(free.balanceBefore, 1000);
  assert.equal(free.balanceAfter, 600);
  assert.equal(free.applied, true);
  assert.equal(free.reason, null);
  assert.equal(free.scopeLabel, "All products");
  assert.match(free.label, /11/);

  assert.equal(restricted.bucketId, 12);
  assert.equal(restricted.amount, 0, "a card with nothing in scope funds nothing");
  assert.equal(restricted.balanceBefore, 300);
  assert.equal(restricted.balanceAfter, 300, "and its balance is untouched");
  assert.equal(restricted.restricted, true);
  assert.equal(restricted.scopeLabel, "Category: spices");
  assert.match(restricted.reason, /scope/i);
});

test("a basket nothing in the wallet can reach is a shortfall, not a crash", () => {
  const plan = planWalletSpend({ buckets: [], lineItems: [{ unitPrice: 100, quantity: 1 }], amount: 100 });
  assert.deepEqual(plan.allocations, []);
  assert.deepEqual(plan.breakdown, []);
  assert.equal(plan.covered, 0);
  assert.equal(plan.shortfall, 100);
  assert.equal(plan.fullyCovered, false);
});

// ============================================================ spend, in a DB

test("spending debits the buckets the plan chose and writes one DEBIT row each", async () => {
  const { customer, nikeBucket, freeBucket, lines } = await mixedFixture();
  const orderUuid = randomUUID();

  const plan = await inTx((client) =>
    spendGiftCardBalanceInTx(client, {
      customerId: customer.id,
      lineItems: lines,
      amount: 500,
      orderUuid,
      reference: `ORDER:${orderUuid}`,
    })
  );

  assert.deepEqual(plan.allocations, [{ bucketId: nikeBucket, amount: 300 }, { bucketId: freeBucket, amount: 200 }]);
  assert.equal(plan.covered, 500);
  assert.equal(plan.shortfall, 0);
  assert.equal(plan.balanceAfter, 400, "900 in the wallet, 500 spent");

  assert.equal(await bucketRemaining(nikeBucket), 0);
  assert.equal(await bucketRemaining(freeBucket), 400);
  assert.equal(await Wallet.balanceFor(customer.id), 400);

  // balance_after is the WALLET TOTAL once each row applied, not that row's own
  // bucket remainder: 900 - 300 = 600, then 600 - 200 = 400.
  const debits = await debitsFor(orderUuid);
  assert.deepEqual(debits, [
    { bucketId: nikeBucket, amount: -300, balanceAfter: 600 },
    { bucketId: freeBucket, amount: -200, balanceAfter: 400 },
  ]);
});

test("a restricted card is not spent by an order whose lines carry no brand", async () => {
  const customer = await seedCustomer();
  await seedWallet(customer.id, [{ initialValue: 500, applicability: [{ type: "BRAND", value: "Nike" }] }]);

  // The failure this guards is silent: a line with no brand is not an error, it
  // is a line the scope cannot match, and the money is then unspent with nothing
  // anywhere reporting a reason.
  const plan = await inTx((client) =>
    spendGiftCardBalanceInTx(client, {
      customerId: customer.id,
      lineItems: [{ unitPrice: 500, quantity: 1, productId: randomUUID() }],
      amount: 500,
      orderUuid: randomUUID(),
    })
  );

  assert.equal(plan.covered, 0);
  assert.equal(await Wallet.balanceFor(customer.id), 500);
  assert.equal((await debitsFor(randomUUID())).length, 0);
});

test("two checkouts spending one balance cannot both take it", async () => {
  const customer = await seedCustomer();
  const { bucketIds } = await seedWallet(customer.id, [{ initialValue: 100 }]);
  const bucket = bucketIds[0];
  const cart = [{ unitPrice: 1000, quantity: 1, brand: "Nike" }];

  const spend = async (amount, sync) => {
    try {
      return await inTx(async (client) => {
        // Both transactions are open and about to read the same buckets. Without
        // this the test proves nothing: whichever happened to finish first would
        // leave the other looking at a settled balance.
        await sync();
        const plan = await spendGiftCardBalanceInTx(client, {
          customerId: customer.id,
          lineItems: cart,
          amount,
          orderUuid: randomUUID(),
        });
        return { ok: true, covered: plan.covered };
      });
    } catch (error) {
      return { ok: false, error: error.message };
    }
  };

  // 80 + 80 against a balance of 100. Neither is out of the question alone, so
  // only the row lock can decide it. Whichever transaction runs second blocks on
  // the first's lock, re-reads the reduced remainder under it, and plans the
  // smaller spend rather than discovering at the write that the money is gone.
  const sync = rendezvous(2);
  const outcomes = await Promise.all([spend(80, sync), spend(80, sync)]);

  assert.ok(
    outcomes.every((o) => o.ok),
    `both checkouts should place an order, one of them smaller: ${JSON.stringify(outcomes)}`
  );
  // The invariant that matters: not one rupee more left the wallet than it held.
  assert.equal(outcomes.reduce((sum, o) => sum + o.covered, 0), 100);
  assert.equal(await bucketRemaining(bucket), 0);
  assert.equal(await Wallet.balanceFor(customer.id), 0);
  const debits = await debitsForWallet(customer.id);
  assert.equal(debits.length, 2);
  assert.equal(debits.reduce((sum, r) => sum - r.amount, 0), 100, "the ledger cannot show more spent than existed");
  assert.deepEqual(debits.map((r) => r.balanceAfter).sort((a, b) => b - a), [20, 0]);
});

test("without the row lock the same two checkouts spend the balance twice", async () => {
  const customer = await seedCustomer();
  const { bucketIds } = await seedWallet(customer.id, [{ initialValue: 100 }]);
  const bucket = bucketIds[0];
  const cart = [{ unitPrice: 1000, quantity: 1, brand: "Nike" }];

  // spendGiftCardBalanceInTx with its lock removed and its validation removed:
  // read the buckets, plan, write back what is left. Both connections are held at
  // the same point between the read and the write, so both see 100 and both
  // believe they may take 80.
  const unsafeSpend = async (sync) =>
    inTx(async (client) => {
      const buckets = await Wallet.bucketsFor(customer.id, { client });
      const plan = planWalletSpend({ buckets, lineItems: cart, amount: 80 });
      await sync();
      for (const line of plan.allocations) {
        const current = await client.query(
          "SELECT remaining FROM customer_wallet_buckets WHERE id = $1",
          [line.bucketId]
        );
        const remaining = round2(Number(current.rows[0].remaining) - line.amount);
        await client.query(
          "UPDATE customer_wallet_buckets SET remaining = $1, updated_at = now() WHERE id = $2",
          [remaining, line.bucketId]
        );
      }
      return plan.covered;
    });

  const sync = rendezvous(2);
  const [first, second] = await Promise.all([unsafeSpend(sync), unsafeSpend(sync)]);

  // Both orders were charged, 160 of money left a wallet holding 100, and the
  // lost update leaves the bucket at 20 — 60 rupees that no ledger row accounts
  // for. This is what the FOR UPDATE is worth.
  assert.equal(first + second, 160);
  assert.ok(first + second > 100, "more was spent than existed");
  assert.equal(await bucketRemaining(bucket), 20);
  assert.equal(await Wallet.balanceFor(customer.id), 20);
});

// ========================================================== refunds, in a DB

test("a refund restores the same bucket ids and the balance returns to what it was", async () => {
  const { customer, nikeBucket, freeBucket, lines } = await mixedFixture();
  const before = await Wallet.balanceFor(customer.id);
  const orderUuid = randomUUID();

  await inTx((client) =>
    spendGiftCardBalanceInTx(client, { customerId: customer.id, lineItems: lines, amount: 500, orderUuid })
  );
  assert.equal(await Wallet.balanceFor(customer.id), round2(before - 500));

  // The allocation list a refund needs is re-derived from the debit rows, so
  // there is no second copy of the fact that can drift from them.
  assert.deepEqual(await walletAllocationsForOrder(scratch, orderUuid), [
    { bucketId: nikeBucket, amount: 300 },
    { bucketId: freeBucket, amount: 200 },
  ]);

  const restored = await inTx((client) =>
    refundWalletSpendInTx(client, { orderUuid, reference: "REFUND" })
  );

  assert.equal(restored, 500);
  // Restored into the buckets it came out of: a brand-restricted card's money
  // refunded to the wallet total would become unrestricted spending.
  assert.equal(await bucketRemaining(nikeBucket), 300);
  assert.equal(await bucketRemaining(freeBucket), 600);
  assert.equal(await Wallet.balanceFor(customer.id), before);
});

test("a second refund of the same order is capped and creates no value", async () => {
  const { customer, lines } = await mixedFixture();
  const orderUuid = randomUUID();
  await inTx((client) =>
    spendGiftCardBalanceInTx(client, { customerId: customer.id, lineItems: lines, amount: 500, orderUuid })
  );

  const first = await inTx((client) => refundWalletSpendInTx(client, { orderUuid }));
  const balanceAfterFirst = await Wallet.balanceFor(customer.id);
  const second = await inTx((client) => refundWalletSpendInTx(client, { orderUuid }));
  const third = await inTx((client) => refundWalletSpendInTx(client, { orderUuid }));

  assert.equal(first, 500);
  assert.equal(second, 0, "a retried refund books nothing");
  assert.equal(third, 0);
  assert.equal(await Wallet.balanceFor(customer.id), balanceAfterFirst, "and the balance never grows");

  const refunds = await scratch.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM customer_reward_transactions
      WHERE type = 'REFUND' AND order_uuid = $1::uuid`,
    [orderUuid]
  );
  assert.equal(Number(refunds.rows[0].total), 500, "exactly one refund's worth of value came back");
});

test("the cancel path refunds the wallet to the buckets it spent from", async () => {
  const { customer, nikeBucket, freeBucket, lines } = await mixedFixture();
  const before = await Wallet.balanceFor(customer.id);
  const orderUuid = randomUUID();

  await inTx((client) =>
    spendGiftCardBalanceInTx(client, { customerId: customer.id, lineItems: lines, amount: 500, orderUuid })
  );

  // The real caller, which owns a transaction of its own because the order's
  // status change has already committed by the time it is reached.
  const reversed = await reverseGiftRedemption(scratch, orderUuid, {
    reason: "Order cancelled",
    performedBy: "admin@example.test",
  });

  assert.equal(reversed.restored, 0, "no legacy card was used, so nothing is restored there");
  assert.equal(reversed.walletRestored, 500);
  assert.equal(await bucketRemaining(nikeBucket), 300);
  assert.equal(await bucketRemaining(freeBucket), 600);
  assert.equal(await Wallet.balanceFor(customer.id), before);

  // And running it again — a support agent clicking twice — restores nothing.
  const again = await reverseGiftRedemption(scratch, orderUuid, { reason: "Order cancelled" });
  assert.equal(again.walletRestored, 0);
  assert.equal(await Wallet.balanceFor(customer.id), before);
});

test("a wallet refund that cannot complete is reported, never swallowed", async () => {
  const { customer, nikeBucket, lines } = await mixedFixture();
  const orderUuid = randomUUID();
  await inTx((client) =>
    spendGiftCardBalanceInTx(client, { customerId: customer.id, lineItems: lines, amount: 500, orderUuid })
  );

  // The database refusing the REFUND row is the same trick as above: a
  // constraint it can be made to enforce on demand. The order's status change has
  // already committed by the time the refund runs, so this must NOT throw — the
  // admin cannot re-drive a cancel of a terminal order — and it must NOT quietly
  // report success either.
  await scratch.query(
    `ALTER TABLE customer_reward_transactions
       ADD CONSTRAINT gc_spend_no_refunds CHECK (type <> 'REFUND') NOT VALID`
  );
  let reversed;
  try {
    reversed = await reverseGiftRedemption(scratch, orderUuid, { reason: "Order cancelled" });
  } finally {
    await scratch.query(
      `ALTER TABLE customer_reward_transactions DROP CONSTRAINT gc_spend_no_refunds`
    );
  }

  assert.ok(reversed.walletError, "the caller is told the balance is still out");
  assert.equal(reversed.walletRestored, 0);
  // And the failed attempt left nothing half-applied: refundInTx rolled back, so
  // the bucket is where the debit left it and no REFUND row exists.
  assert.equal(await bucketRemaining(nikeBucket), 0);
  assert.deepEqual(await refundsForWallet(customer.id), [], "no REFUND row survived the rollback");

  // With the obstruction gone, the same refund succeeds — which is why the
  // failure is safe to leave visible instead of caching it.
  const retried = await reverseGiftRedemption(scratch, orderUuid, { reason: "Order cancelled" });
  assert.equal(retried.walletRestored, 500);
  assert.equal(retried.walletError, null);
  assert.equal(await bucketRemaining(nikeBucket), 300);
});

// ================================================ the quote writes nothing

test("the quote prices the wallet buckets and writes nothing at all", async () => {
  const { customer, nikeBucket, freeBucket, lines, basketValue } = await mixedFixture();

  const before = await moneySnapshot();
  const { status, body } = await callQuote({
    subtotal: basketValue,
    customerEmail: customer.email,
    useGiftCard: true,
    items: lines.map((line) => ({
      ...line.request,
      unitPrice: line.unitPrice,
      brand: line.brand,
      category: line.category,
    })),
  });
  const after = await moneySnapshot();

  assert.equal(status, 200);
  assert.equal(body.success, true);

  // The additive field, and the legacy ones untouched around it.
  assert.equal(body.walletSpend.covered, 500);
  assert.deepEqual(
    body.walletSpend.allocations.map((a) => [a.bucketId, a.amount]),
    [
      [nikeBucket, 300],
      [freeBucket, 200],
    ],
    "restricted first, then what is left"
  );
  assert.equal(body.walletSpend.shortfall, 0);
  assert.equal(body.walletSpend.fullyCovered, true);
  assert.equal(body.total, 0);
  assert.equal(body.subtotal, basketValue);
  assert.equal(body.discount, 0);
  assert.equal(body.giftAmount, 0);
  assert.equal(body.giftCard, null);
  assert.deepEqual(body.giftCards, []);
  assert.equal(body.coupon, null);
  assert.equal(body.couponError, "");
  assert.equal(body.giftError, "");

  // Row for row, including every updated_at: no wallet row, no bucket, no ledger
  // row, no legacy transaction, no order, no stock movement.
  assert.deepEqual(after, before);
  assert.equal(await Wallet.balanceFor(customer.id), 900, "previewing spent nothing");
});

test("the quote says nothing about the wallet when the shopper did not ask to use it", async () => {
  const { customer, basketValue } = await mixedFixture();

  const { status, body } = await callQuote({ subtotal: basketValue, customerEmail: customer.email });

  assert.equal(status, 200);
  assert.equal(body.walletSpend, null);
  assert.equal(body.total, basketValue, "an unticked balance changes nothing");
});

test("the quote will not read another customer's balance", async () => {
  const victim = await seedCustomer();
  const victimBuckets = await seedWallet(victim.id, [{ initialValue: 500, applicability: [] }]);
  const other = await seedCustomer();

  // A guessed id is not a credential. The legacy card path above matches on the
  // email too, but the v2 wallet has nothing else to match on, so an id whose row
  // is not this email's buys nothing.
  const { status, body } = await callQuote({
    subtotal: 500,
    customerEmail: other.email,
    customerId: victim.id,
    useGiftCard: true,
  });

  assert.equal(status, 200);
  assert.equal(round2(body.walletSpend?.covered || 0), 0, "no balance of somebody else's was spent");
  assert.equal(body.total, 500);
  const mentioned = (body.walletSpend?.breakdown || []).map((line) => line.bucketId);
  assert.ok(!mentioned.includes(victimBuckets.bucketIds[0]), "and none of it is even named in the reply");
  assert.equal(await Wallet.balanceFor(victim.id), 500);
});

test("a quote whose basket arrives unpriced still prices the balance", async () => {
  const { customer, basketValue } = await mixedFixture();

  // What the storefront actually sends: product uuids and quantities, no prices,
  // because the order route is what prices a line. Lines worth nothing would cap
  // every bucket at ₹0 and the quote would claim a ₹900 balance does not apply.
  const { status, body } = await callQuote({
    subtotal: basketValue,
    customerEmail: customer.email,
    useGiftCard: true,
    items: [{ product_uuid: randomUUID(), quantity: 1 }],
  });

  assert.equal(status, 200);
  assert.equal(body.walletSpend.covered, basketValue);
  assert.equal(body.total, 0);
});

// ============================================= the order route, end to end

test("placing an order debits the wallet inside the order's own transaction", async () => {
  const { customer, nikeBucket, freeBucket, lines, basketValue } = await mixedFixture();

  const { status, body } = await callOrder({
    customerName: "Spend Tester",
    customerEmail: customer.email,
    paymentMethod: "cod",
    useGiftCard: true,
    items: lines.map((line) => line.request),
  });

  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.success, true);

  const order = await orderRow(body.order.uuid);
  assert.equal(Number(order.subtotal), basketValue);
  assert.equal(Number(order.total), 0, "the wallet paid the whole basket");

  assert.equal(await bucketRemaining(nikeBucket), 0);
  assert.equal(await bucketRemaining(freeBucket), 400);
  assert.equal(await Wallet.balanceFor(customer.id), 400);

  // The debit is attributed to the order that caused it, which is the record a
  // refund reads to know which buckets to restore.
  const debits = await debitsFor(body.order.uuid);
  assert.deepEqual(
    debits.map((d) => [d.bucketId, d.amount]),
    [
      [nikeBucket, -300],
      [freeBucket, -200],
    ]
  );
});

test("the order route leaves the wallet alone when the shopper did not ask to use it", async () => {
  const { customer, nikeBucket, lines, basketValue } = await mixedFixture();

  const { status, body } = await callOrder({
    customerName: "Spend Tester",
    customerEmail: customer.email,
    useGiftCard: false,
    items: lines.map((line) => line.request),
  });

  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(Number((await orderRow(body.order.uuid)).total), basketValue);
  assert.equal(await bucketRemaining(nikeBucket), 300);
  assert.equal(await Wallet.balanceFor(customer.id), 900);
});

test("a failure after the wallet spend rolls the whole order back", async () => {
  const { customer, nikeBucket, lines } = await mixedFixture();

  // The same trick claimGiftCard.test.mjs uses: a constraint the database can be
  // made to enforce on demand. The order INSERT happens after the wallet has been
  // debited, so this is a failure strictly inside the spend's transaction — the
  // worst possible moment, and the one the all-or-nothing promise is about.
  await scratch.query(
    `ALTER TABLE orders ADD CONSTRAINT gc_spend_forced_failure CHECK (subtotal < 0) NOT VALID`
  );
  let failed;
  try {
    failed = await callOrder({
      customerName: "Spend Tester",
      customerEmail: customer.email,
      useGiftCard: true,
      items: lines.map((line) => line.request),
    });
  } finally {
    await scratch.query(`ALTER TABLE orders DROP CONSTRAINT gc_spend_forced_failure`);
  }

  assert.equal(failed.status, 500);
  assert.equal(failed.body.success, false);

  // Nothing of the order exists...
  const orders = await scratch.query("SELECT id FROM orders WHERE customer_email = $1", [customer.email]);
  assert.equal(orders.rows.length, 0, "a failed checkout leaves no order behind");
  // ...the stock decrement went with it...
  const nike = lines[0];
  const stock = await scratch.query(
    "SELECT stock FROM products WHERE uuid = $1",
    [nike.product_uuid]
  );
  assert.equal(Number(stock.rows[0].stock), 100, "the stock decrement rolled back too");
  // ...and the money is exactly where it was.
  assert.equal(await bucketRemaining(nikeBucket), 300, "the wallet is untouched");
  assert.equal(await Wallet.balanceFor(customer.id), 900);
  const debits = await debitsForWallet(customer.id);
  assert.equal(debits.length, 0, "and no ledger row survives a rolled-back order");
});

test("the quote and the order route charge the same plan from the same basket", async () => {
  const { customer, lines, basketValue } = await mixedFixture();
  const items = lines.map((line) => ({
    ...line.request,
    unitPrice: line.unitPrice,
    brand: line.brand,
    category: line.category,
  }));

  const quoted = await callQuote({ subtotal: basketValue, customerEmail: customer.email, useGiftCard: true, items });
  const placed = await callOrder({
    customerName: "Spend Tester",
    customerEmail: customer.email,
    useGiftCard: true,
    items: lines.map((line) => line.request),
  });

  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  // The figure the shopper was shown is the figure they were charged, and the
  // per-bucket split behind it is the same one — one plan, two call sites.
  assert.equal(Number((await orderRow(placed.body.order.uuid)).total), quoted.body.total);
  assert.equal(
    quoted.body.walletSpend.allocations.map((a) => [a.bucketId, a.amount]).length,
    2
  );
});

test.after(async () => {
  await scratch.end().catch(() => {});
  await modelPool.end().catch(() => {});
});
