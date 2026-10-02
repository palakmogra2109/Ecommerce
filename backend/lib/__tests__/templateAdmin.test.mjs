import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnv } from "../../scripts/lib/env.mjs";

// The environment first, exactly as giftCardCodeModel.test.mjs and
// storeWalletRoute.test.mjs do it.
await loadEnv();

// ------------------------------------------------------- the @/ path mapping
//
// The same resolver storeWalletRoute.test.mjs uses, because the routes under test
// are the REAL route files rather than copies of their bodies — so a test that
// passes here is a test of what ships. Next resolves `@/*` and `@shared/*`
// through tsconfig paths and its bundler; node:test resolves neither, and it also
// refuses the extensionless relative imports the codebase is full of
// ("../db", "./giftCardRules").
//
// Exactly ONE module is substituted: lib/authorization, whose authenticate() needs
// next/headers. It is pointed at a sibling stub rather than mocked away, so the
// route imports the same module instance the test arranges the caller through.
//
// `@shared/*` needs the extra `format: "module"`. shared/ has no package.json of
// its own, so Node would read shared/constants.js as CommonJS and refuse its named
// exports — and unlike the authorization stub, that module cannot be substituted,
// because the routes under test have to be reading the real permission slugs.
const BACKEND_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHARED_ROOT = path.join(BACKEND_ROOT, "..", "shared");
const AUTH_STUB = new URL("./templateAdminAuth.mjs", import.meta.url).href;

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
    if (specifier === "@/lib/authorization") {
      return { url: AUTH_STUB, shortCircuit: true };
    }
    if (specifier.startsWith("@shared/")) {
      const file = asFile(path.join(SHARED_ROOT, specifier.slice("@shared/".length)));
      if (file) return { url: pathToFileURL(file).href, format: "module", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const file = asFile(path.join(BACKEND_ROOT, specifier.slice(2)));
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
// Same rule as every other DB-backed test here, and for the sharper reason: this
// file PATCHes and archives templates and then calls the real purchase service
// against them. Run against the live `ecommerce` database, this suite would
// archive real gift cards and — worse — could leave a scratch row sellable to a
// real customer. So a scratch database is created from sql/schema.sql and
// everything below runs against that.
//
// LEFT BEHIND at the end of the run (as giftCardCodeModel.test.mjs and
// purchaseGiftCard.test.mjs do) so a failed run can be inspected with psql against
// `gc_templateadmin`. The next run drops it first, WITH FORCE, so a run that died
// holding a connection cannot make the next one fail for the wrong reason.
import pg from "pg";

const BASE_URL = process.env.DATABASE_URL.replace(/\/[^/]*$/, "/");
const SCRATCH_DB = "gc_templateadmin";
const SCRATCH_URL = `${BASE_URL}${SCRATCH_DB}`;

const admin = new pg.Pool({ connectionString: `${BASE_URL}postgres` });
await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
await admin.end();

// lib/db.js builds its Pool at module scope out of process.env.DATABASE_URL, and
// Node caches an imported module for the life of the process. Both together mean
// the variable has to be repointed BEFORE anything imports it — which is why
// these are `await import()` and why the block above cannot move into a hook.
process.env.DATABASE_URL = SCRATCH_URL;

const scratch = new pg.Pool({ connectionString: SCRATCH_URL });
// Resolved against this file rather than process.cwd(), so the suite runs the
// same way whether npm started it from backend/ or a script did.
await scratch.query(fs.readFileSync(new URL("../../sql/schema.sql", import.meta.url), "utf8"));

const listRoute = await import("../../app/api/store/gift-cards/templates/route.js");
const oneRoute = await import("../../app/api/store/gift-cards/templates/[id]/route.js");
const { signIn, signOut, permissionsAsked } = await import("./templateAdminAuth.mjs");
const { GiftCardCode, CODE_STATUS } = await import("../models/giftCardCode.js");
const { purchaseGiftCard } = await import("../services/purchaseGiftCard.js");
const { SandboxProvider } = await import("../payment/sandbox.js");
const { sellabilityOf } = await import("../giftCardSellability.js");
const modelPool = (await import("../db.js")).default;

// ------------------------------------------------------------------- plumbing

const ADMIN = { id: 1, email: "template-admin@example.test" };
const EMAIL = "shopper@example.test";

// `response` is carried alongside the parsed body so a test can check headers on
// a response it has already read; reading the body does not consume the headers.
const json = async (response) => ({
  status: response.status,
  body: await response.json(),
  response,
});

const callList = async (query = "") =>
  json(await listRoute.GET(new Request(`http://localhost/api/store/gift-cards/templates${query}`, { method: "GET" })));

const callGet = async (ref) =>
  json(
    await oneRoute.GET(
      new Request(`http://localhost/api/store/gift-cards/templates/${ref}`, { method: "GET" }),
      { params: Promise.resolve({ id: String(ref) }) }
    )
  );

const callPatch = async (ref, payload) =>
  json(
    await oneRoute.PATCH(
      new Request(`http://localhost/api/store/gift-cards/templates/${ref}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
      { params: Promise.resolve({ id: String(ref) }) }
    )
  );

const callDelete = async (ref) =>
  json(
    await oneRoute.DELETE(
      new Request(`http://localhost/api/store/gift-cards/templates/${ref}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: String(ref) }) }
    )
  );

// ------------------------------------------------------------------- seeding

let seq = 0;

async function seedTemplate({
  faceValue = 1000,
  initialAmount = null,
  // Most templates here hold no balance at all — a template's money is issued per
  // code, not held. Tests about balances set it explicitly.
  balance = 0,
  sellingPrice = null,
  status = "ACTIVE",
  isActive = true,
  label = null,
  description = null,
  codeLast4 = null,
  code = null,
  startsAt = null,
  endsAt = null,
  validityDays = null,
} = {}) {
  seq += 1;
  const initial = initialAmount == null ? faceValue : initialAmount;
  const result = await scratch.query(
    `INSERT INTO gift_cards
       (label, description, initial_amount, balance, currency, status, is_active,
        face_value, selling_price, validity_days, starts_at, ends_at, code, code_hash, code_last4)
     VALUES ($1, $2, $3, $4, 'INR', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id, uuid`,
    [
      label ?? `Admin Template ${seq}`,
      description ?? `Description ${seq}`,
      initial,
      balance,
      status,
      isActive,
      faceValue,
      sellingPrice,
      validityDays,
      startsAt,
      endsAt,
      code,
      code ? "f".repeat(63) + String(seq).slice(-1) : null,
      codeLast4,
    ]
  );
  return { id: Number(result.rows[0].id), uuid: result.rows[0].uuid };
}

// The brands and categories resolveScopeRows checks against, so a real
// restriction can be saved. Real rows rather than a mock: a restriction that
// "resolves" against nothing is exactly what the write side refuses to store.
// brands.slug and categories.slug are NOT NULL and UNIQUE, so both are given.
let catalogueSeq = 0;
async function seedCatalogue() {
  catalogueSeq += 1;
  const suffix = randomUUID().slice(0, 8);
  const brand = await scratch.query(
    "INSERT INTO brands (name, slug) VALUES ($1, $2) RETURNING name",
    [`Brand ${catalogueSeq} ${suffix}`, `brand-${suffix}`]
  );
  const category = await scratch.query(
    "INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING slug",
    [`Category ${catalogueSeq}`, `category-${suffix}`]
  );
  return { brand: brand.rows[0].name, category: category.rows[0].slug };
}

async function issueCode(templateId) {
  const plaintext = `gift-admin-${String(seq + 1).padStart(4, "0")}-${randomUUID().slice(0, 8)}`;
  const client = await scratch.connect();
  try {
    await client.query("BEGIN");
    const row = await GiftCardCode.issueInTx(client, { templateId, code: plaintext });
    await client.query("COMMIT");
    return { ...row, plaintext };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const scopeOf = async (templateId) =>
  (await scratch.query(
    "SELECT kind, value FROM gift_card_applicability WHERE template_id = $1 ORDER BY kind, value",
    [templateId]
  )).rows;

const rowOf = async (templateId) =>
  (await scratch.query(
    `SELECT status, is_active, face_value, initial_amount, balance, label, selling_price,
            validity_days, per_order_limit, max_quantity_per_order, starts_at, ends_at,
            description, updated_at
       FROM gift_cards WHERE id = $1`,
    [templateId]
  )).rows[0];

// The whole row, for handing straight to sellabilityOf — which is the same shape
// purchaseGiftCard.js's loadTemplate hands it, so the two callers are comparable.
const fullRow = async (templateId) =>
  (await scratch.query("SELECT * FROM gift_cards WHERE id = $1", [templateId])).rows[0];

// What a shopper would get if the storefront tried to sell it. The whole point of
// the admin screen is that this and the screen agree, so it is asked directly.
const attemptPurchase = async (templateId) => {
  try {
    await purchaseGiftCard({
      templateId,
      quantity: 1,
      recipientEmail: EMAIL,
      provider: new SandboxProvider(),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error?.code ?? null, message: error?.message };
  }
};

test.beforeEach(() => {
  signIn(ADMIN);
});

test.after(async () => {
  await scratch.end().catch(() => {});
  await modelPool.end().catch(() => {});
});

// ===================================================== the list: what a template is

test("the list returns real templates with isSellable true and their applicability", async () => {
  const { brand, category } = await seedCatalogue();
  const template = await seedTemplate({ faceValue: 750, sellingPrice: 700, label: "Spice Season" });
  await scratch.query(
    `INSERT INTO gift_card_applicability (template_id, kind, value)
     VALUES ($1, 'BRAND', $2), ($1, 'CATEGORY', $3)`,
    [template.id, brand, category]
  );

  const { status, body } = await callList("?search=Spice");
  assert.equal(status, 200);
  assert.equal(body.success, true);

  const [found] = body.templates;
  assert.equal(found.id, template.id);
  assert.equal(found.label, "Spice Season");
  assert.equal(found.faceValue, 750);
  assert.equal(found.sellingPrice, 700);
  assert.equal(found.isActive, true);
  assert.equal(found.isSellable, true);
  // Nothing is wrong with it, so there is no reason to report — an admin screen
  // that always renders a "not sellable" chip reads as though everything is broken.
  assert.equal(found.notSellableReason, null);
  assert.deepEqual(found.applicability, [
    { kind: "BRAND", value: brand },
    { kind: "CATEGORY", value: category },
  ]);
  assert.match(found.scopeLabel, /Brand: /);
  assert.equal(body.pagination.total, 1);
});

test("a NULL face_value template is listable but not sellable, and says which column is wrong", async () => {
  // Exactly the shape of all seven legacy rows in the live database: is_active
  // true, a value in initial_amount, and no face_value at all — and status still
  // reading ACTIVE. Without a face value check the storefront would sell them as
  // products, which is the whole reason migration 020 retires them.
  const legacy = await seedTemplate({ faceValue: null, initialAmount: 44, status: "ACTIVE" });

  const { body } = await callList();
  const [found] = body.templates.filter((t) => t.id === legacy.id);
  assert.ok(found);
  assert.equal(found.status, "ACTIVE");
  assert.equal(found.isActive, true);
  assert.equal(found.isSellable, false);
  assert.equal(found.notSellableReason.code, "TEMPLATE_NO_VALUE");
  assert.match(found.notSellableReason.message, /faceValue/);

  // And the storefront agrees with the screen, which is the point of factoring
  // the rule into one function.
  const outcome = await attemptPurchase(legacy.id);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "TEMPLATE_NO_VALUE");
});

test("the list excludes the retired legacy states and includes ARCHIVED", async () => {
  const active = await seedTemplate({ faceValue: 100 });
  const archived = await seedTemplate({ faceValue: 200, status: "ARCHIVED" });
  // CANCELLED and REDEEMED are the two statuses in the column's CHECK that
  // describe an ISSUED card rather than a product. Migration 017 is what moved
  // those rows into gift_card_codes; anything still holding one of those is a
  // card somebody already spent, and it must not be offered as a product.
  const cancelled = await seedTemplate({ faceValue: 300, status: "CANCELLED" });
  const redeemed = await seedTemplate({ faceValue: 400, status: "REDEEMED" });

  const { body } = await callList();
  const ids = body.templates.map((t) => t.id);
  assert.ok(ids.includes(active.id), "a live product is listed");
  assert.ok(ids.includes(archived.id), "a retired template is still listed, so an admin can see it");
  assert.ok(!ids.includes(cancelled.id), "a cancelled card is not a product");
  assert.ok(!ids.includes(redeemed.id), "a redeemed card is not a product");
});

test("a PATCH that changes no column is a no-op, and still reports the template in full", async () => {
  const template = await seedTemplate({
    faceValue: 100,
    label: "Untouched",
    code: "PLAINTEXT-4242",
    codeLast4: "4242",
  });
  const before = await rowOf(template.id);

  // An empty body is a save from a form that changed nothing, which is an ordinary
  // thing for a UI to send. It must not claim to have written anything, and it
  // must not bump updated_at.
  const { status, body } = await callPatch(template.id, {});
  assert.equal(status, 200);
  assert.equal(body.success, true);

  const after = await rowOf(template.id);
  assert.equal(after.label, before.label);
  // pg hands back a fresh Date per query, so the comparison is on the instant and
  // not on object identity.
  assert.equal(after.updated_at.getTime(), before.updated_at.getTime(), "a no-op save must not touch updated_at");

  // And the response is the whole template, masked as everywhere else — including
  // the last4, which used to come back null on exactly this path because the row
  // read back was the pre-image rather than a fresh one.
  assert.equal(body.template.label, "Untouched");
  assert.equal(body.template.codeLast4, "4242");
  assert.ok(!("code" in body.template));
  assert.ok(!JSON.stringify(body).includes("PLAINTEXT-4242"));
});

test("a status filter is intersected with the listable vocabulary, never substituted for it", async () => {
  await seedTemplate({ faceValue: 300, status: "CANCELLED" });

  // A real status that is not listable: an honest empty list, not the rows.
  const filtered = await callList("?status=CANCELLED");
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.pagination.total, 0);

  // A status the column does not accept at all is a 400 rather than an empty list
  // an admin reads as "there are none".
  const bogus = await callList("?status=NONSENSE");
  assert.equal(bogus.status, 400);
  assert.equal(bogus.body.code, "INVALID_STATUS");
});

test("no list row carries a plaintext code, and the only code field is a last4", async () => {
  // A legacy issued card really does hold a plaintext code in this table, so a
  // template list is exactly where one would leak.
  const legacy = await seedTemplate({
    faceValue: null,
    initialAmount: 10000,
    status: "ARCHIVED",
    code: "LEGACY-PLAINTEXT-0001",
    codeLast4: "0001",
  });

  const { body } = await callList();
  const found = body.templates.find((t) => t.id === legacy.id);
  assert.ok(found);
  assert.equal(found.codeLast4, "0001");
  assert.ok(!("code" in found), "no code field at all, so no plaintext can ride in it");
  assert.ok(!("code_hash" in found), "the lookup hash is what an offline attacker needs");
  assert.ok(!JSON.stringify(body).includes("LEGACY-PLAINTEXT-0001"));
});

test("the list is paginated the way the admin cards list is", async () => {
  // Isolated by a search term rather than counted absolutely: every test in this
  // file shares one scratch database, so an exact total would be a statement
  // about test ordering rather than about pagination.
  const marker = `Paged ${randomUUID().slice(0, 8)}`;
  for (let i = 0; i < 5; i += 1) {
    await seedTemplate({ faceValue: 100 + i, label: `${marker} ${i}` });
  }

  const first = await callList(`?search=${encodeURIComponent(marker)}&page=1&limit=2`);
  assert.equal(first.status, 200);
  assert.equal(first.body.templates.length, 2);
  assert.equal(first.body.pagination.page, 1);
  assert.equal(first.body.pagination.limit, 2);
  assert.equal(first.body.pagination.total, 5);
  assert.equal(first.body.pagination.totalPages, 3);

  const third = await callList(`?search=${encodeURIComponent(marker)}&page=3&limit=2`);
  assert.equal(third.body.templates.length, 1);
  assert.equal(third.body.pagination.total, 5);

  // Newest first, the same ordering app/api/gift-cards/route.js uses.
  assert.deepEqual(
    first.body.templates.map((t) => t.label),
    [`${marker} 4`, `${marker} 3`]
  );
});

// ============================================================ the single read

test("GET [id] returns one template with its scope, by id or by uuid", async () => {
  const { category } = await seedCatalogue();
  const template = await seedTemplate({
    faceValue: 250,
    description: "A single card",
    code: "PLAINTEXT-9999",
    codeLast4: "9999",
  });
  await scratch.query(
    "INSERT INTO gift_card_applicability (template_id, kind, value) VALUES ($1, 'CATEGORY', $2)",
    [template.id, category]
  );

  const byId = await callGet(template.id);
  assert.equal(byId.status, 200);
  assert.equal(byId.body.template.faceValue, 250);
  assert.equal(byId.body.template.description, "A single card");
  assert.deepEqual(byId.body.template.applicability, [{ kind: "CATEGORY", value: category }]);
  assert.equal(byId.body.template.issuedCodes, 0);

  // Masking on the single read too, and the same shape as the list.
  assert.ok(!("code" in byId.body.template));
  assert.ok(!("code_hash" in byId.body.template));
  assert.ok(!JSON.stringify(byId.body).includes("PLAINTEXT-9999"));

  // Both references resolve to the same template, because the admin panel holds
  // ids and a link holds a uuid and neither shape can be mistaken for the other.
  const byUuid = await callGet(template.uuid);
  assert.equal(byUuid.status, 200);
  assert.equal(byUuid.body.template.id, template.id);
});

test("a reference that is neither a uuid nor an id is a 404, not a 500", async () => {
  // Deliberately a 404 rather than a 400, matching app/api/gift-cards/[id]: a
  // caller who may read every template must not probe which exist by reading the
  // difference between "malformed" and "missing".
  for (const ref of ["not-a-reference", "../../etc/passwd", "12; DROP TABLE gift_cards"]) {
    const { status, body } = await callGet(ref);
    assert.equal(status, 404, `expected 404 for ${ref}`);
    assert.equal(body.code, "TEMPLATE_NOT_FOUND");
  }
});

// ==================================================================== PATCH

test("PATCHing faceValue writes initial_amount too, so the two cannot drift", async () => {
  const template = await seedTemplate({ faceValue: 1000 });

  const { status, body } = await callPatch(template.id, { faceValue: 555.5 });
  assert.equal(status, 200);
  assert.equal(body.template.faceValue, 555.5);
  assert.equal(body.template.initialAmount, 555.5);

  const row = await rowOf(template.id);
  assert.equal(Number(row.face_value), 555.5);
  // The point of the whole rule. issueInTx stamps from initial_amount, so this
  // column is what a customer would actually receive.
  assert.equal(Number(row.initial_amount), 555.5);

  // Rounded through the same round2 the create route uses, so 1.005 is 1.01 on
  // both columns rather than 1.00 on one of them.
  const fractional = await callPatch(template.id, { faceValue: 0.105 });
  assert.equal(fractional.status, 200);
  assert.equal(fractional.body.template.faceValue, 0.11);
  const rounded = await rowOf(template.id);
  assert.equal(Number(rounded.face_value), Number(rounded.initial_amount));
});

test("an edit that would break the face_value/initial_amount agreement is refused outright", async () => {
  const template = await seedTemplate({ faceValue: 1000 });

  const refused = await callPatch(template.id, { initialAmount: 900 });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "TEMPLATE_VALUE_MISMATCH");
  // The message has to name BOTH numbers, because "these must agree" on a form
  // with two identical-looking amount fields is not an answer.
  assert.match(refused.body.message, /1000/);
  assert.match(refused.body.message, /900/);
  assert.match(refused.body.message, /faceValue on its own/);

  // Refused, not half-applied.
  const row = await rowOf(template.id);
  assert.equal(Number(row.initial_amount), 1000);
  assert.equal(Number(row.face_value), 1000);

  // Sending a matching pair is accepted, so the refusal is about disagreement
  // and not about the field being read-only.
  const agreed = await callPatch(template.id, { faceValue: 1000, initialAmount: 1000 });
  assert.equal(agreed.status, 200);
});

test("faceValue cannot be cleared, and an unrelated edit on a broken row still works", async () => {
  // ACTIVE and unsellable: the two states are independent, and a row in this one
  // is a live product that happens to be broken.
  const broken = await seedTemplate({ faceValue: null, initialAmount: 44, status: "ACTIVE" });

  const cleared = await callPatch(broken.id, { faceValue: null });
  assert.equal(cleared.status, 400);
  assert.equal(cleared.body.code, "FACE_VALUE_REQUIRED");

  // An edit that touches neither value column is never refused for the agreement.
  // A screen that could not relabel a broken card would be worse than the bug.
  const relabelled = await callPatch(broken.id, { label: "Legacy card" });
  assert.equal(relabelled.status, 200);
  assert.equal(relabelled.body.template.label, "Legacy card");
  assert.equal(relabelled.body.template.isSellable, false);
  assert.equal(relabelled.body.template.notSellableReason.code, "TEMPLATE_NO_VALUE");

  // And the repair itself works: a face value brings it back on sale.
  const repaired = await callPatch(broken.id, { faceValue: 44 });
  assert.equal(repaired.status, 200);
  assert.equal(repaired.body.template.isSellable, true);
});

test("PATCH replaces the applicability wholesale rather than appending to it", async () => {
  const catalogue = await seedCatalogue();
  const other = await seedCatalogue();
  const template = await seedTemplate({ faceValue: 300 });
  await scratch.query("INSERT INTO gift_card_applicability (template_id, kind, value) VALUES ($1, 'BRAND', $2)", [
    template.id,
    other.brand,
  ]);

  // Save a different scope. If this appended, the old brand would still be there
  // and "remove this brand" would be impossible to express.
  const saved = await callPatch(template.id, {
    applicability: [{ kind: "CATEGORY", value: catalogue.category }],
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.template.applicability, [{ kind: "CATEGORY", value: catalogue.category }]);
  assert.deepEqual(await scopeOf(template.id), [{ kind: "CATEGORY", value: catalogue.category }]);

  // Saving again with nothing replaces nothing, rather than leaving the previous
  // save in place — which is what "replace" means.
  const cleared = await callPatch(template.id, { applicability: [] });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body.template.applicability, []);
  assert.deepEqual(await scopeOf(template.id), []);

  // An unknown value is refused and nothing is written, so a typo cannot leave a
  // card restricted to a brand that does not exist.
  const typo = await callPatch(template.id, { applicability: [{ kind: "BRAND", value: "No Such Brand" }] });
  assert.equal(typo.status, 400);
  assert.equal(typo.body.code, "APPLICABILITY_NOT_FOUND");
});

test("PATCH updates the catalogue fields and refuses the ones the column will not take", async () => {
  const template = await seedTemplate({ faceValue: 100 });

  const ok = await callPatch(template.id, {
    label: "Autumn Card",
    description: "Spices and pulses",
    sellingPrice: 95,
    validityDays: 180,
    perOrderLimit: 500,
    maxQuantityPerOrder: 4,
    isActive: true,
  });
  assert.equal(ok.status, 200);
  const row = await rowOf(template.id);
  assert.equal(row.label, "Autumn Card");
  assert.equal(row.description, "Spices and pulses");
  assert.equal(Number(row.selling_price), 95);
  assert.equal(row.validity_days, 180);
  assert.equal(Number(row.per_order_limit), 500);
  assert.equal(row.max_quantity_per_order, 4);

  // Every one of these is the admin's mistake, so every one is a 4xx and never a
  // 500. A 500 here would tell them to retry something that fails identically.
  for (const [payload, code] of [
    [{ label: "   " }, "INVALID_LABEL"],
    [{ sellingPrice: "free" }, "INVALID_SELLING_PRICE"],
    [{ validityDays: 0 }, "INVALID_VALIDITY_DAYS"],
    [{ maxQuantityPerOrder: 1.5 }, "INVALID_MAX_QUANTITY"],
    [{ isActive: "false" }, "INVALID_IS_ACTIVE"],
    [{ status: "NONSENSE" }, "INVALID_STATUS"],
    [{ faceValue: -5 }, "INVALID_FACE_VALUE"],
  ]) {
    const result = await callPatch(template.id, payload);
    assert.equal(result.status, 400, `${JSON.stringify(payload)} should be a 400`);
    assert.equal(result.body.code, code);
  }

  // EXPIRED is derived from expires_at and never stored, so accepting it would
  // write a value that reads back as something else entirely.
  const expired = await callPatch(template.id, { status: "EXPIRED" });
  assert.equal(expired.status, 400);
  assert.match(expired.body.message, /never stored/);
});

test("a sell window that ends before it starts is a 400, not a constraint violation", async () => {
  const template = await seedTemplate({ faceValue: 100 });
  const bad = await callPatch(template.id, {
    startsAt: "2026-12-01T00:00:00Z",
    endsAt: "2026-01-01T00:00:00Z",
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "INVALID_SELL_WINDOW");
});

test("PATCH never touches money that is not the face value", async () => {
  const template = await seedTemplate({ faceValue: 1000 });
  await scratch.query("UPDATE gift_cards SET balance = 400 WHERE id = $1", [template.id]);

  const updated = await callPatch(template.id, { faceValue: 2000 });
  assert.equal(updated.status, 200);

  const row = await rowOf(template.id);
  // initial_amount follows face_value because it IS the face value; balance does
  // not, because balance is money already issued and it only moves through the
  // ledgered adjust path.
  assert.equal(Number(row.initial_amount), 2000);
  assert.equal(Number(row.balance), 400);
});

// ============================================= archive-and-pause, and the store

test("archiving and pausing stops the storefront selling the template", async () => {
  const template = await seedTemplate({ faceValue: 500 });

  // The sell gate is open to begin with, so every refusal below is caused by the
  // admin's own edit and not by a template that never worked.
  assert.equal(sellabilityOf(await fullRow(template.id)).sellable, true);

  // Pausing is the lighter half: the gate closes, the history stays.
  const paused = await callPatch(template.id, { isActive: false });
  assert.equal(paused.status, 200);
  assert.equal(paused.body.template.isActive, false);
  assert.equal(paused.body.template.status, "ACTIVE");
  assert.equal(paused.body.template.isSellable, false);
  assert.equal(paused.body.template.notSellableReason.code, "TEMPLATE_NOT_SELLABLE");
  const whilePaused = await attemptPurchase(template.id);
  assert.equal(whilePaused.ok, false);
  assert.equal(whilePaused.code, "TEMPLATE_NOT_SELLABLE");

  // Back on sale, then archived. Both halves matter: status is what stops a
  // retired template, and is_active is the gate a later accidental status flip
  // would otherwise walk straight back through.
  const relisted = await callPatch(template.id, { isActive: true });
  assert.equal(relisted.body.template.isSellable, true);
  const archived = await callDelete(template.id);
  assert.equal(archived.status, 200);
  assert.equal(archived.body.template.status, "ARCHIVED");
  assert.equal(archived.body.template.isActive, false);
  assert.equal(archived.body.template.isSellable, false);

  const after = await attemptPurchase(template.id);
  assert.equal(after.ok, false);
  assert.equal(after.code, "TEMPLATE_ARCHIVED");

  // No purchase row and no code was written by any of those attempts: the
  // refusals happen before anything is committed.
  const purchases = await scratch.query(
    "SELECT count(*)::int AS n FROM gift_card_purchases WHERE template_id = $1",
    [template.id]
  );
  const codes = await scratch.query(
    "SELECT count(*)::int AS n FROM gift_card_codes WHERE template_id = $1",
    [template.id]
  );
  assert.equal(purchases.rows[0].n, 0);
  assert.equal(codes.rows[0].n, 0);
});

test("a template outside its sale window is listed as not sellable", async () => {
  const future = await seedTemplate({
    faceValue: 100,
    startsAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const past = await seedTemplate({
    faceValue: 100,
    endsAt: new Date(Date.now() - 86400000).toISOString(),
  });

  const { body } = await callList();
  const futureRow = body.templates.find((t) => t.id === future.id);
  const pastRow = body.templates.find((t) => t.id === past.id);
  assert.equal(futureRow.isSellable, false);
  assert.equal(futureRow.notSellableReason.code, "TEMPLATE_NOT_ON_SALE");
  assert.equal(pastRow.isSellable, false);
  assert.match(pastRow.notSellableReason.message, /starts_at and ends_at/);
});

// ================================================================== DELETE

test("DELETE archives rather than deleting, and says so in words", async () => {
  const template = await seedTemplate({ faceValue: 400 });

  const { status, body } = await callDelete(template.id);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.archived, true);
  // The message must not say "deleted", or the UI and the admin's expectation
  // diverge from what actually happened to the row.
  assert.match(body.message, /archiv/i);
  assert.ok(!/deleted/i.test(body.message), `message said deleted: ${body.message}`);

  // The row is still there, with its history intact.
  const row = await rowOf(template.id);
  assert.equal(row.status, "ARCHIVED");
  assert.equal(row.is_active, false);
  assert.equal(Number(row.face_value), 400);
  assert.equal(row.label.startsWith("Admin Template"), true);

  // Idempotent: a retried admin action reports the state instead of failing.
  const again = await callDelete(template.id);
  assert.equal(again.status, 200);
  assert.equal(again.body.archived, true);
  assert.match(again.body.message, /already archived/i);
});

test("archiving a template with issued codes leaves the codes and their foreign key intact", async () => {
  const template = await seedTemplate({ faceValue: 900 });
  const first = await issueCode(template.id);
  const second = await issueCode(template.id);
  await scratch.query("UPDATE gift_card_codes SET status = $1 WHERE id = $2", [CODE_STATUS.REDEEMED, second.id]);

  const { status, body } = await callDelete(template.id);
  assert.equal(status, 200);
  assert.equal(body.template.issuedCodes, 2);
  assert.match(body.message, /2 issued codes/);

  // Every code is still there, still pointing at the template, with its own
  // status and value. gift_card_codes.template_id is ON DELETE RESTRICT, so a
  // real DELETE would have failed outright here.
  const codes = await scratch.query(
    "SELECT id, template_id, status, face_value FROM gift_card_codes WHERE template_id = $1 ORDER BY id",
    [template.id]
  );
  assert.equal(codes.rows.length, 2);
  // BIGSERIAL arrives from pg as a string, so ids are compared as Numbers.
  assert.deepEqual(codes.rows.map((r) => Number(r.id)), [Number(first.id), Number(second.id)]);
  assert.deepEqual(codes.rows.map((r) => Number(r.template_id)), [template.id, template.id]);
  assert.deepEqual(codes.rows.map((r) => r.status), ["UNUSED", "REDEEMED"]);
  for (const code of codes.rows) assert.equal(Number(code.face_value), 900);

  // And the row itself survived, so the FK still resolves.
  assert.equal((await rowOf(template.id)).status, "ARCHIVED");

  // A code's value came from initial_amount at issue time and is unchanged by
  // the archive: a card already in somebody's hands does not lose its money
  // because its product was retired.
  for (const code of codes.rows) assert.equal(Number(code.face_value), 900);
});

test("a template that never issued a code is archived too, with the reason stated", async () => {
  const template = await seedTemplate({ faceValue: 100 });

  const { status, body } = await callDelete(template.id);
  assert.equal(status, 200);
  assert.equal(body.template.issuedCodes, 0);
  // Even with nothing pointing at it, the row is kept — an ARCHIVED template can
  // still answer "what was the ₹250 card" next quarter.
  assert.match(body.message, /never issued a code/);
  assert.equal((await rowOf(template.id)).status, "ARCHIVED");
});

test("DELETE on a reference that does not resolve is a 404", async () => {
  assert.equal((await callDelete(99999999)).status, 404);
  assert.equal((await callDelete("not-a-reference")).status, 404);
});

// ===================================================== permissions and CORS

test("each route is behind its own gift-card permission", async () => {
  const template = await seedTemplate({ faceValue: 100 });

  signIn(ADMIN, { permissions: ["gift_cards.view"] });
  assert.equal((await callList()).status, 200);
  assert.equal((await callGet(template.id)).status, 200);
  assert.equal((await callPatch(template.id, { label: "No" })).status, 403);
  assert.equal((await callDelete(template.id)).status, 403);

  // And the slugs asked for are the documented ones, not something a nearer one.
  signIn(ADMIN);
  await callList();
  await callGet(template.id);
  await callPatch(template.id, { label: "Yes" });
  await callDelete(template.id);
  assert.deepEqual(permissionsAsked(), [
    "gift_cards.view",
    "gift_cards.view",
    "gift_cards.update",
    "gift_cards.delete",
  ]);

  // An unauthenticated caller gets 401 on every one of them.
  signOut();
  assert.equal((await callList()).status, 401);
  assert.equal((await callPatch(template.id, { label: "No" })).status, 401);
  assert.equal((await callDelete(template.id)).status, 401);
});

test("every route answers OPTIONS, and every response carries the CORS headers", async () => {
  for (const handler of [listRoute.OPTIONS, oneRoute.OPTIONS]) {
    const response = await handler();
    assert.equal(response.status, 204);
    assert.ok(response.headers.get("access-control-allow-origin"));
    assert.match(response.headers.get("access-control-allow-methods"), /PATCH/);
  }

  // A browser cannot read an error it was not allowed to see, so a refusal that
  // omits the headers reads as a network failure rather than as a 403 or a 400.
  // Successes and refusals alike are checked.
  const template = await seedTemplate({ faceValue: 100 });
  const responses = [
    await json(await listRoute.GET(new Request("http://localhost/api/store/gift-cards/templates"))),
    await callPatch(template.id, { status: "NONSENSE" }),
    await callPatch(template.id, { faceValue: 1 }),
    await callGet("not-a-reference"),
  ];
  for (const { response } of responses) {
    assert.ok(response.headers.get("access-control-allow-origin"), "missing CORS origin");
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  }
});

// ============================================ migration 020, on this same database
//
// The migration is verified against the live shape in a database of its own, in
// the last block of this file, because it is the one thing here that must not be
// run against anything else. It is seeded exactly as live reads today: one row
// already migrated into gift_card_codes and one that is not.

test("migration 020 retires the legacy rows, moves no money, and is a no-op on a second run", async () => {
  const migration = fs.readFileSync(
    new URL("../../sql/migrations/020-retire-legacy-gift-cards.sql", import.meta.url),
    "utf8"
  );

  // Two rows in the shape of the live legacy data: ACTIVE, is_active true, no
  // face_value at all, one of them already carrying a gift_card_codes row from
  // migration 017 and one of them issued from the panel afterwards with nothing.
  const migrated = await seedTemplate({
    faceValue: null,
    initialAmount: 10000,
    balance: 10000,
    status: "ACTIVE",
  });
  await scratch.query(
    "INSERT INTO gift_card_codes (template_id, code_hash, code_last4, status, currency, face_value) VALUES ($1, $2, '9999', 'UNUSED', 'INR', 10000)",
    [migrated.id, "e".repeat(63) + "9"]
  );
  // A row carrying real money, so "the migration moved no money" is a statement
  // about a non-zero number. Live card 58 held 652; this is the same shape.
  const unmigrated = await seedTemplate({
    faceValue: null,
    initialAmount: 652,
    balance: 652,
    status: "ACTIVE",
  });

  // A real template, which must survive: it has no code row, so a migration keyed
  // on "no code row" alone would archive it.
  const real = await seedTemplate({ faceValue: 500 });

  const sums = async () => {
    const totals = await scratch.query(
      "SELECT COALESCE(SUM(balance),0) AS b, COALESCE(SUM(initial_amount),0) AS i FROM gift_cards"
    );
    const ledger = await scratch.query("SELECT count(*)::int AS n FROM gift_card_transactions");
    return { balance: Number(totals.rows[0].b), initial: Number(totals.rows[0].i), ledger: ledger.rows[0].n };
  };
  const statusesOf = async (id) => (await rowOf(id)).status;

  const before = await sums();
  const ledgerBefore = await scratch.query(
    "SELECT count(*)::int AS n FROM gift_card_transactions WHERE gift_card_id = ANY($1::bigint[])",
    [[migrated.id, unmigrated.id]]
  );
  assert.equal(ledgerBefore.rows[0].n, 0, "neither card has a ledger row yet");

  await scratch.query(migration);

  // Both legacy rows retired; the real template untouched. The real template is
  // the one that matters most here — it has no code row, so a migration keyed on
  // "no code row" alone would have archived the first real template the shop sold.
  assert.equal(await statusesOf(migrated.id), "ARCHIVED");
  assert.equal(await statusesOf(unmigrated.id), "ARCHIVED");
  assert.equal(await statusesOf(real.id), "ACTIVE");
  assert.equal(Number((await rowOf(real.id)).face_value), 500);

  // Money did not move. Asserted on the two rows this test owns, because the
  // migration correctly also retires the NULL-face_value fixtures the earlier
  // tests in this file left behind — those are indistinguishable from live's
  // legacy cards by design, and retiring them is the whole point.
  for (const [id, initial] of [
    [migrated.id, 10000],
    [unmigrated.id, 652],
  ]) {
    const row = await rowOf(id);
    assert.equal(Number(row.initial_amount), initial, `initial_amount moved on ${id}`);
    assert.equal(Number(row.balance), initial, `balance moved on ${id}`);
  }
  const after = await sums();
  assert.equal(after.balance, before.balance, "no balance anywhere in the table moved");
  assert.equal(after.initial, before.initial, "no initial_amount anywhere in the table moved");

  // Exactly one ledger row, for the un-migrated card alone, and it says the money
  // did not move: amount 0 with balance_before equal to balance_after.
  const ledger = await scratch.query(
    `SELECT gift_card_id, type, amount, balance_before, balance_after, metadata
       FROM gift_card_transactions
      WHERE metadata @> $1::jsonb AND gift_card_id = ANY($2::bigint[])
      ORDER BY gift_card_id`,
    [{ migration: "020-retire-legacy-gift-cards" }, [migrated.id, unmigrated.id]]
  );
  assert.equal(ledger.rows.length, 1, "one retirement row, for the un-migrated card only");
  assert.equal(Number(ledger.rows[0].gift_card_id), unmigrated.id);
  assert.equal(ledger.rows[0].type, "CANCELLED");
  assert.equal(Number(ledger.rows[0].amount), 0);
  assert.equal(Number(ledger.rows[0].balance_before), Number(ledger.rows[0].balance_after));
  assert.equal(Number(ledger.rows[0].balance_after), 652, "the row records the unchanged balance");

  // The code of the already-migrated card is untouched by the retirement: it
  // already has its own audit trail, so it gets no second one.
  const code = await scratch.query("SELECT status, face_value FROM gift_card_codes WHERE template_id = $1", [migrated.id]);
  assert.equal(code.rows[0].status, "UNUSED");
  assert.equal(Number(code.rows[0].face_value), 10000);

  // And the second run changes nothing at all: not a status, not a rupee, and
  // not a second ledger row for the same card.
  const snapshot = await scratch.query(
    "SELECT id, status, is_active, face_value, initial_amount, balance FROM gift_cards ORDER BY id"
  );
  const ledgerSnapshot = await scratch.query(
    "SELECT id, gift_card_id, type, amount, balance_before, balance_after FROM gift_card_transactions ORDER BY id"
  );
  await scratch.query(migration);
  assert.deepEqual(
    (await scratch.query(
      "SELECT id, status, is_active, face_value, initial_amount, balance FROM gift_cards ORDER BY id"
    )).rows,
    snapshot.rows
  );
  assert.deepEqual(
    (await scratch.query(
      "SELECT id, gift_card_id, type, amount, balance_before, balance_after FROM gift_card_transactions ORDER BY id"
    )).rows,
    ledgerSnapshot.rows,
    "a second run wrote no second retirement row for the same card"
  );
  assert.deepEqual(await sums(), after, "a second run moved nothing");

  // The retired rows are off sale afterwards, and the real template is not.
  const { body } = await callList();
  for (const id of [migrated.id, unmigrated.id]) {
    const listed = body.templates.find((t) => t.id === id);
    assert.ok(listed, "a retired template is still listable");
    assert.equal(listed.isSellable, false);
  }
  assert.equal(body.templates.find((t) => t.id === real.id).isSellable, true);
});