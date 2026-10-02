import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "../../scripts/lib/env.mjs";

// The environment first, exactly as the other DB-backed suites do it.
await loadEnv();

import pg from "pg";

// ---------------------------------------------------------------- throwaway DB
//
// The point of this file is the DIALECT: a stored restriction value has to be the
// exact thing the spend path compares, or a card's money silently matches nothing.
// That can only be proven against a real database — a mocked lookup would happily
// agree with whatever spelling it was given. So this runs against a scratch
// database built from sql/schema.sql, never the live `ecommerce` one.
//
// LEFT BEHIND after the run, like giftCardCodeModel.test.mjs and the other scratch
// suites, so a failure can be inspected with psql against `gc_scopetest`. The next
// run drops it first with FORCE.
const BASE_URL = process.env.DATABASE_URL.replace(/\/[^/]*$/, "/");
const SCRATCH_DB = "gc_scopetest";
const SCRATCH_URL = `${BASE_URL}${SCRATCH_DB}`;

const admin = new pg.Pool({ connectionString: `${BASE_URL}postgres` });
await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
await admin.end();

// Before anything that opens the module-scope Pool built out of DATABASE_URL.
process.env.DATABASE_URL = SCRATCH_URL;

const scratch = new pg.Pool({ connectionString: SCRATCH_URL });
await scratch.query(fs.readFileSync(new URL("../../sql/schema.sql", import.meta.url), "utf8"));

const {
  describeScope,
  resolveScopeRows,
  resolveScopeValue,
  scopeRowsFrom,
  writeScopeRows,
} = await import("../giftCardTemplateScope.js");
const { GiftCardCode } = await import("../models/giftCardCode.js");
const { isEligible, isUnrestricted } = await import("../giftCardApplicability.js");

// ------------------------------------------------------------------- seeding
//
// name and slug are deliberately different for every row below, because that
// difference IS the thing under test: a card scoped to `brands.name` must not be
// scoped to `brands.slug`, and a card scoped to `categories.slug` must not be
// scoped to `categories.name`.
//
// slug is unique per table, so it carries the test's own sequence number. The
// name is left clean on purpose — it is the value under test, and a name with a
// digit in it would not prove that lookup is case- and slug-insensitive in the way
// a real catalogue name is.

let rowSeq = 0;
const slugFor = (stem) => `${stem}-${(rowSeq += 1)}`;

async function seedBrand(name) {
  const slug = slugFor(name.toLowerCase().replace(/[^a-z]+/g, "-"));
  const result = await scratch.query(
    "INSERT INTO brands (name, slug) VALUES ($1, $2) RETURNING id, name, slug",
    [name, slug]
  );
  return result.rows[0];
}

async function seedCategory(name) {
  const slug = slugFor(name.toLowerCase().replace(/[^a-z]+/g, "-"));
  const result = await scratch.query(
    "INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id, name, slug",
    [name, slug]
  );
  return result.rows[0];
}

async function seedProduct({ name, slug, brandId = null, categoryId = null }) {
  const result = await scratch.query(
    `INSERT INTO products (name, slug, sku, price, brand_id, category_id, status)
     VALUES ($1, $2, $3, 100, $4, $5, 'ACTIVE') RETURNING uuid, name, slug`,
    [name, slug, `SKU-${slug}`, brandId, categoryId]
  );
  return result.rows[0];
}

async function seedTemplate() {
  const result = await scratch.query(
    `INSERT INTO gift_cards (label, initial_amount, balance, currency, status, is_active, face_value)
     VALUES ('Scope Template', 500, 500, 'INR', 'ACTIVE', TRUE, 500) RETURNING id`
  );
  return Number(result.rows[0].id);
}

// The scope of a template, read back the way a claim reads it.
const scopeOf = async (templateId) => GiftCardCode.applicabilityForTemplate(templateId);

// ------------------------------------------------------------------- folding

test("both scope shapes fold into rows, deduplicated case-insensitively", async () => {
  const rows = scopeRowsFrom([{ kind: "BRAND", value: "Nila Organics" }, { kind: "CATEGORY", value: "spices" }]);
  assert.deepEqual(rows.error, null);
  assert.deepEqual(rows.rows, [
    { kind: "BRAND", value: "Nila Organics" },
    { kind: "CATEGORY", value: "spices" },
  ]);

  // The admin form's shape, folded by the same normalizeScope the spend path uses.
  const folded = scopeRowsFrom({ brands: ["Nila Organics"], categories: ["spices"], productIds: [] });
  assert.deepEqual(folded.rows, [
    { kind: "BRAND", value: "Nila Organics" },
    { kind: "CATEGORY", value: "spices" },
  ]);

  // A duplicate is dropped rather than becoming a UNIQUE violation, and a case
  // difference counts as the duplicate it is.
  const dupes = scopeRowsFrom({
    brands: ["Nila Organics", " nila organics ", "Nila Organics"],
    categories: ["  spices "],
  });
  assert.deepEqual(dupes.rows, [
    { kind: "BRAND", value: "Nila Organics" },
    { kind: "CATEGORY", value: "spices" },
  ]);

  // Absent and empty both mean no restrictions, which is UNRESTRICTED and not
  // restricted-to-nothing.
  assert.deepEqual(scopeRowsFrom(null).rows, []);
  assert.deepEqual(scopeRowsFrom([]).rows, []);
  assert.deepEqual(scopeRowsFrom({}).rows, []);
});

test("a scope nobody can read is refused rather than stored", async () => {
  // normalizeScope fails closed, and that has to arrive here too: an unreadable
  // restriction stored as though it were no restriction would widen what a card's
  // money may buy.
  assert.ok(scopeRowsFrom("nonsense").error);
  assert.ok(scopeRowsFrom([{ kind: "WIDGET", value: "x" }]).error);
  assert.ok(scopeRowsFrom({ nonsense: true }).error);
  // A present-but-empty restriction is readable: it means no restriction.
  assert.equal(scopeRowsFrom({ brands: [], categories: [], productIds: [] }).error, null);
});

// ------------------------------------------------------------------ the dialect

test("BRAND resolves against brands.name, not brands.slug", async () => {
  const brand = await seedBrand("Nila Organics");

  const byName = await resolveScopeValue(scratch, "BRAND", "Nila Organics");
  assert.equal(byName.ok, true);
  assert.equal(byName.value, "Nila Organics");

  // Case-insensitive on the way in, canonical on the way out — the spend path
  // lowercases both sides, so storing the catalogue's own spelling is what keeps
  // the row readable as well as matchable.
  const shouty = await resolveScopeValue(scratch, "BRAND", "NILA ORGANICS");
  assert.equal(shouty.ok, true);
  assert.equal(shouty.value, "Nila Organics");

  // The slug is NOT the brand name for this path.
  const bySlug = await resolveScopeValue(scratch, "BRAND", brand.slug);
  assert.equal(bySlug.ok, false);
  assert.equal(bySlug.reason, "not_found");
  assert.notEqual(brand.slug, brand.name);
});

test("CATEGORY resolves against categories.slug, not categories.name", async () => {
  const category = await seedCategory("Whole Spices");

  const bySlug = await resolveScopeValue(scratch, "CATEGORY", category.slug);
  assert.equal(bySlug.ok, true);
  assert.equal(bySlug.value, category.slug);

  // The name is NOT the category for this path. Storing it would produce a card
  // whose restriction matches no line item at checkout.
  const byName = await resolveScopeValue(scratch, "CATEGORY", "Whole Spices");
  assert.equal(byName.ok, false);
  assert.notEqual(category.slug, "Whole Spices");
});

test("PRODUCT resolves against products.uuid, and anything else is refused", async () => {
  const product = await seedProduct({ name: "Turmeric 100g", slug: slugFor("turmeric") });

  const byUuid = await resolveScopeValue(scratch, "PRODUCT", product.uuid);
  assert.equal(byUuid.ok, true);
  assert.equal(byUuid.value, product.uuid);

  // Not the numeric id, not the slug, not a malformed uuid.
  for (const bad of ["1", product.slug, "not-a-uuid", ""]) {
    const result = await resolveScopeValue(scratch, "PRODUCT", bad);
    assert.equal(result.ok, false, `${bad} must not resolve to a product`);
  }
});

test("an unknown kind is refused before any lookup", async () => {
  const result = await resolveScopeValue(scratch, "WIDGET", "anything");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unknown_kind");
});

test("resolveScopeRows names the offending row so the create can be refused", async () => {
  const brand = await seedBrand("Nila Organics");

  const bad = await resolveScopeRows(scratch, [
    { kind: "BRAND", value: brand.name },
    { kind: "CATEGORY", value: "no-such-slug" },
  ]);
  assert.equal(bad.resolved, null);
  assert.deepEqual(bad.error, { kind: "CATEGORY", value: "no-such-slug", reason: "not_found" });

  const good = await resolveScopeRows(scratch, [{ kind: "BRAND", value: brand.name }]);
  assert.equal(good.error, null);
  assert.deepEqual(good.resolved, [{ kind: "BRAND", value: "Nila Organics" }]);
});

// ------------------------------------------------------- the spend path agrees

test("a stored scope is one the SPEND path actually matches", async () => {
  const brand = await seedBrand("Nila Organics");
  const other = await seedBrand("Coastal Co", "coastal-co");
  const category = await seedCategory("Whole Spices");
  const product = await seedProduct({
    name: "Turmeric 100g",
    slug: slugFor("turmeric"),
    brandId: Number(brand.id),
    categoryId: Number(category.id),
  });
  const templateId = await seedTemplate();

  const { resolved, error } = await resolveScopeRows(scratch, [
    { kind: "BRAND", value: brand.name },
    { kind: "CATEGORY", value: category.slug },
    { kind: "PRODUCT", value: product.uuid },
  ]);
  assert.equal(error, null);
  await writeScopeRows(scratch, templateId, resolved);

  // Read back exactly as a claim reads it, then judge it exactly as checkout
  // judges it — through the line-item shape app/api/orders/store/route.js builds.
  const scope = await scopeOf(templateId);
  assert.deepEqual(scope, [
    { type: "BRAND", value: brand.name },
    { type: "CATEGORY", value: category.slug },
    { type: "PRODUCT", value: product.uuid },
  ]);

  const line = {
    brand: brand.name,
    category: category.slug,
    productId: product.uuid,
    unitPrice: 120,
    quantity: 1,
  };
  assert.equal(isEligible(scope, line), true);
  assert.equal(isUnrestricted(scope), false);

  // Every restriction is an AND, so a line item that misses any one of them is
  // ineligible — which is what makes the values above worth verifying.
  assert.equal(isEligible(scope, { ...line, brand: other.name }), false);
  assert.equal(isEligible(scope, { ...line, category: "some-other-slug" }), false);
  assert.equal(isEligible(scope, { ...line, productId: "11111111-2222-3333-4444-555555555555" }), false);

  // And the failure mode this whole file exists to prevent: a restriction stored
  // with the wrong dialect matches nothing at all, so the card is simply unusable
  // and nothing says why.
  const wrongDialect = [{ type: "BRAND", value: brand.slug }];
  assert.equal(isEligible(wrongDialect, line), false);
});

test("a template with no applicability rows is unrestricted", async () => {
  const templateId = await seedTemplate();
  const scope = await scopeOf(templateId);

  assert.deepEqual(scope, []);
  assert.equal(isUnrestricted(scope), true);
  assert.equal(isEligible(scope, { brand: "anything", category: "anything", productId: "anything" }), true);

  await writeScopeRows(scratch, templateId, []);
  assert.deepEqual(await scopeOf(templateId), []);
});

test("describeScope captions a stored scope the way the wallet does", async () => {
  assert.equal(describeScope([]), "All products");
  assert.equal(
    describeScope([
      { kind: "BRAND", value: "Nila Organics" },
      { kind: "CATEGORY", value: "whole-spices" },
    ]),
    "Brand: Nila Organics, Category: whole-spices"
  );
  // A product list is counted rather than enumerated.
  assert.equal(
    describeScope([{ kind: "PRODUCT", value: "11111111-2222-3333-4444-555555555555" }]),
    "Product: 1 item"
  );
});