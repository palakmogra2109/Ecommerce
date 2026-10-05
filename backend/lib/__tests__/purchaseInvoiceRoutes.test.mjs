import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { loadEnv } from "../../scripts/lib/env.mjs";
// Registers the @/ and @shared/ path aliases before any route is imported.
import "./helpers/aliasHooks.mjs";

await loadEnv();

// These drive the real route handlers, the real SQL and the real
// authenticate(): a genuine JWT is minted against JWT_SECRET and a genuine
// ACTIVE super-admin row is created in the scratch database. Only the Next
// transport (cookies()/headers()) is stubbed.
const BASE = process.env.DATABASE_URL.replace(/\/[^/]*$/, "/");
const SCRATCH = "gc_pi_routes";

const admin = new pg.Pool({ connectionString: BASE + "postgres" });
await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${SCRATCH}`);
await admin.end();
process.env.DATABASE_URL = BASE + SCRATCH;

const requestHeaders = new Headers();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(fs.readFileSync("sql/schema.sql", "utf8"));
// Migration 023 seeds permissions; schema.sql is the fresh-install shape, so
// replay the permission rows here exactly as a migrated database would have.
await pool.query(fs.readFileSync("sql/migrations/023-purchase-permissions.sql", "utf8"));

const { createToken } = await import("../../lib/auth.js");

// An ACTIVE super-admin with a real session. hasPermission short-circuits on
// super_admin, which is how a real admin reaches these routes today.
const adminUser = (
  await pool.query(
    `INSERT INTO users (name,email,password,status)
     VALUES ('Route Admin','route.admin@example.test','x','ACTIVE') RETURNING id`,
  )
).rows[0];
// schema.sql creates the roles table but does not seed it; roles are populated
// per deployment, so the test creates the one it needs.
const superAdminRole = (
  await pool.query(
    `INSERT INTO roles (name, slug, description, status)
     VALUES ('Super Admin','super_admin','Full access','ACTIVE') RETURNING id`
  )
).rows[0].id;
await pool.query(
  "INSERT INTO user_has_roles (user_id, role_id) VALUES ($1, $2)",
  [adminUser.id, superAdminRole]
);
globalThis.__requestAuth = {
  token: await createToken({ id: adminUser.id, email: "route.admin@example.test" }),
  headers: new Headers(),
};

const suppliersRoute = await import("../../app/api/suppliers/route.js");
const supplierRoute = await import("../../app/api/suppliers/[id]/route.js");
const invoicesRoute = await import("../../app/api/purchase-invoices/route.js");
const invoiceRoute = await import("../../app/api/purchase-invoices/[id]/route.js");
const receiveRoute = await import("../../app/api/purchase-invoices/[id]/receive/route.js");
const payRoute = await import("../../app/api/purchase-invoices/[id]/payments/route.js");
const servicePool = (await import("../../lib/db.js")).default;

const params = (id) => ({ params: Promise.resolve({ id }) });
const post = (route, body, id) =>
  route.POST({ headers: requestHeaders, json: async () => body }, id ? params(id) : undefined);
const body = (res) => res.json();

let seq = 0;
async function seed() {
  seq += 1;
  const product = (
    await pool.query(
      "INSERT INTO products (name,slug,sku,price,stock,status) VALUES ($1,$2,$3,100,0,'ACTIVE') RETURNING id",
      [`Part ${seq}`, `part-${seq}`, `SKU-${seq}`]
    )
  ).rows[0].id;
  const created = await post(suppliersRoute, { name: `Supplier ${seq}`, email: `s${seq}@example.test` });
  assert.equal(created.status, 201, "supplier seed should succeed");
  return { product, supplier: (await body(created)).supplier };
}

test.after(async () => {
  await pool.end();
  await servicePool.end().catch(() => {});
  const a = new pg.Pool({ connectionString: BASE + "postgres" });
  await a.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  await a.end();
});

// ── suppliers ──────────────────────────────────────────────────────────────

test("POST /api/suppliers creates a supplier", async () => {
  const res = await post(suppliersRoute, {
    name: "Acme Components", contact_name: "Ravi", email: "ravi@acme.test",
    gstin: "29ABCDE1234F1Z5", payment_terms_days: 30,
  });
  assert.equal(res.status, 201);
  const { supplier } = await body(res);
  assert.equal(supplier.name, "Acme Components");
  assert.equal(supplier.gstin, "29ABCDE1234F1Z5");
  assert.equal(supplier.country, "IN", "country falls back to the column default");
  assert.equal(supplier.payment_terms_days, 30);
  assert.ok(supplier.uuid, "supplier is addressable by uuid");
});

test("a tax ID with punctuation, or a bad email, is rejected with the reason", async () => {
  // Letters and digits are accepted at any length: the field is a supplier tax
  // registration, not strictly a GSTIN, because overseas and SEZ suppliers do
  // not have one. Punctuation is what actually gets refused.
  const bad = await post(suppliersRoute, { name: "X", gstin: "GSTIN-12/34" });
  assert.equal(bad.status, 422);
  assert.match((await body(bad)).message, /letters and numbers/i);

  const bad2 = await post(suppliersRoute, { name: "X", email: "not-an-email" });
  assert.equal(bad2.status, 422);

  const noName = await post(suppliersRoute, { email: "a@b.co" });
  assert.equal(noName.status, 422);
  assert.match((await body(noName)).message, /name is required/);
});

test("GET /api/suppliers lists and filters", async () => {
  const all = await suppliersRoute.GET({ headers: requestHeaders, url: "http://x/api/suppliers" });
  const { suppliers, pagination } = await body(all);
  assert.equal(all.status, 200);
  assert.ok(suppliers.length >= 1);
  assert.ok(pagination.total >= 1);

  const searched = await suppliersRoute.GET({
    headers: requestHeaders,
    url: "http://x/api/suppliers?search=Acme",
  });
  const found = await body(searched);
  assert.equal(found.suppliers.length, 1);
  assert.equal(found.suppliers[0].name, "Acme Components");
});

test("GET /api/suppliers/[uuid] returns the supplier with its balance", async () => {
  const { supplier } = await seed();
  const res = await supplierRoute.GET({ headers: requestHeaders }, params(supplier.uuid));
  assert.equal(res.status, 200);
  const { supplier: got, balance } = await body(res);
  assert.equal(got.uuid, supplier.uuid);
  assert.deepEqual(balance, { invoiced: 0, paid: 0, outstanding: 0 });
});

test("a malformed uuid is rejected before any query", async () => {
  const res = await supplierRoute.GET({ headers: requestHeaders }, params("not-a-uuid"));
  // The shared helper answers 404 for a malformed id, not 400.
  assert.equal(res.status, 404);
  assert.equal((await body(res)).message, "Invalid id");
});

test("DELETE retires a supplier and PUT brings them back", async () => {
  const { supplier } = await seed();
  const retired = await supplierRoute.DELETE({ headers: requestHeaders }, params(supplier.uuid));
  assert.equal(retired.status, 200);
  assert.equal((await body(retired)).supplier.is_active, false);

  const restored = await supplierRoute.PUT({ headers: requestHeaders }, params(supplier.uuid));
  assert.equal((await body(restored)).supplier.is_active, true);
});

test("a supplier with an open invoice cannot be retired", async () => {
  const { product, supplier } = await seed();
  const inv = await post(invoicesRoute, {
    supplierId: supplier.id, supplierInvoiceNumber: "OPEN-1",
    items: [{ productId: product, quantityOrdered: 5, unitCost: 10 }],
  });
  assert.equal(inv.status, 201);
  const res = await supplierRoute.DELETE({ headers: requestHeaders }, params(supplier.uuid));
  assert.equal(res.status, 422);
  assert.match((await body(res)).message, /still open/);
});

// ── purchase invoices ──────────────────────────────────────────────────────

test("POST /api/purchase-invoices books an invoice with server-side totals", async () => {
  const { product, supplier } = await seed();
  const res = await post(invoicesRoute, {
    supplierId: supplier.id,
    supplierInvoiceNumber: "ACME-77",
    items: [{ productId: product, quantityOrdered: 10, unitCost: 250, taxPercent: 18 }],
  });
  assert.equal(res.status, 201);
  const { invoice } = await body(res);
  assert.match(invoice.invoice_number, /^PI-\d{6}$/);
  assert.equal(invoice.total_amount, 2950);      // 2500 + 18% of 2500
  assert.equal(invoice.status, "AWAITING_STOCK");
  assert.equal(invoice.payment_status, "UNPAID");
  assert.ok(invoice.uuid);
});

test("a duplicate supplier invoice number is a 409, not a 500", async () => {
  const { product, supplier } = await seed();
  const payload = {
    supplierId: supplier.id, supplierInvoiceNumber: "TWICE",
    items: [{ productId: product, quantityOrdered: 1, unitCost: 1 }],
  };
  assert.equal((await post(invoicesRoute, payload)).status, 201);
  const res = await post(invoicesRoute, payload);
  assert.equal(res.status, 409);
  assert.equal((await body(res)).code, "DUPLICATE_INVOICE_NUMBER");
});

test("an inactive supplier is refused with 422", async () => {
  const { product, supplier } = await seed();
  await supplierRoute.DELETE({ headers: requestHeaders }, params(supplier.uuid));
  const res = await post(invoicesRoute, {
    supplierId: supplier.id, supplierInvoiceNumber: "GONE",
    items: [{ productId: product, quantityOrdered: 1, unitCost: 1 }],
  });
  assert.equal(res.status, 422);
  assert.equal((await body(res)).code, "SUPPLIER_INACTIVE");
});

test("GET /api/purchase-invoices filters by status and reports outstanding", async () => {
  const { product, supplier } = await seed();
  const created = await post(invoicesRoute, {
    supplierId: supplier.id, supplierInvoiceNumber: "LIST-1",
    items: [{ productId: product, quantityOrdered: 4, unitCost: 100 }],
  });
  const { invoice } = await body(created);

  // Scoped to this supplier, because the scratch database is shared across tests.
  const all = await invoicesRoute.GET({
    headers: requestHeaders, url: `http://x/api/purchase-invoices?supplierId=${supplier.id}`,
  });
  const { invoices } = await body(all);
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].outstanding, 400);
  assert.equal(invoices[0].supplier_name, supplier.name);
  assert.equal(invoices[0].item_count, 1);

  const awaiting = await invoicesRoute.GET({
    headers: requestHeaders,
    url: `http://x/api/purchase-invoices?supplierId=${supplier.id}&status=AWAITING_STOCK`,
  });
  assert.equal((await body(awaiting)).invoices.length, 1);

  const received = await invoicesRoute.GET({
    headers: requestHeaders,
    url: `http://x/api/purchase-invoices?supplierId=${supplier.id}&status=RECEIVED`,
  });
  assert.equal((await body(received)).invoices.length, 0);

  const bySupplier = await invoicesRoute.GET({
    headers: requestHeaders, url: `http://x/api/purchase-invoices?supplierId=${supplier.id}`,
  });
  assert.equal((await body(bySupplier)).invoices.length, 1);
});

// ── receiving ──────────────────────────────────────────────────────────────

async function bookAndReceive({ accepted, damaged = 0, missing = 0, label }) {
  const { product, supplier } = await seed();
  const created = await post(invoicesRoute, {
    supplierId: supplier.id, supplierInvoiceNumber: `REC-${label}`,
    items: [{ productId: product, quantityOrdered: 10, unitCost: 100 }],
  });
  const { invoice } = await body(created);
  const res = await post(
    receiveRoute,
    { lines: [{ purchaseInvoiceItemId: invoice.items[0].id, accepted, damaged, missing }] },
    invoice.uuid
  );
  const stock = (await pool.query("SELECT stock FROM products WHERE id=$1", [product])).rows[0].stock;
  return { res, invoice, product, stock: Number(stock) };
}

test("POST receive records goods and moves central stock", async () => {
  const { res, invoice, stock } = await bookAndReceive({ accepted: 10, label: "full" });
  assert.equal(res.status, 201);
  const { receipt, status } = await body(res);
  assert.match(receipt.receipt_number, /^GR-\d{6}$/);
  assert.equal(status, "RECEIVED");
  assert.equal(stock, 10);
  assert.equal(invoice.status, "AWAITING_STOCK", "the original invoice was untouched");
});

test("damaged goods do not become sellable stock", async () => {
  const { res, stock } = await bookAndReceive({ accepted: 6, damaged: 4, label: "dmg" });
  assert.equal(res.status, 201);
  assert.equal(stock, 6, "only the accepted 6 lands in products.stock");
  assert.equal((await body(res)).receipt.total_damaged, 4);
});

test("an over-receipt is 422 and changes no stock", async () => {
  const { res, stock } = await bookAndReceive({ accepted: 11, label: "over" });
  assert.equal(res.status, 422);
  assert.equal((await body(res)).code, "OVER_RECEIPT");
  assert.equal(stock, 0);
});

test("an empty receipt is refused", async () => {
  const { product, supplier } = await seed();
  const created = await post(invoicesRoute, {
    supplierId: supplier.id, supplierInvoiceNumber: "EMPTY-REC",
    items: [{ productId: product, quantityOrdered: 1, unitCost: 1 }],
  });
  const { invoice } = await body(created);
  const res = await post(receiveRoute, { lines: [] }, invoice.uuid);
  assert.equal(res.status, 422, "a receipt that records no goods is a state conflict");
});

// ── payments ───────────────────────────────────────────────────────────────

test("POST payment records money and reduces the outstanding", async () => {
  const { product, supplier } = await seed();
  const created = await post(invoicesRoute, {
    supplierId: supplier.id, supplierInvoiceNumber: "PAY-1",
    items: [{ productId: product, quantityOrdered: 10, unitCost: 100 }],
  });
  const { invoice } = await body(created);

  const res = await post(payRoute, { amount: 400, method: "UPI", reference: "UTR123" }, invoice.uuid);
  assert.equal(res.status, 201);
  const { outstanding, invoice: updated } = await body(res);
  assert.equal(outstanding, 600);
  assert.equal(updated.payment_status, "PARTIALLY_PAID");

  const rest = await body(await post(payRoute, { amount: 600, method: "CASH" }, invoice.uuid));
  assert.equal(rest.outstanding, 0);
  assert.equal(rest.invoice.payment_status, "PAID");
});

test("an overpayment is 422 and writes no payment row", async () => {
  const { product, supplier } = await seed();
  const created = await post(invoicesRoute, {
    supplierId: supplier.id, supplierInvoiceNumber: "PAY-2",
    items: [{ productId: product, quantityOrdered: 1, unitCost: 100 }],
  });
  const { invoice } = await body(created);
  const res = await post(payRoute, { amount: 101 }, invoice.uuid);
  assert.equal(res.status, 422);
  assert.equal((await body(res)).code, "OVER_PAYMENT");

  const after = await pool.query(
    "SELECT count(*)::int n FROM purchase_invoice_payments WHERE purchase_invoice_id=$1",
    [invoice.id]
  );
  assert.equal(after.rows[0].n, 0);
});

test("a zero payment is refused", async () => {
  const { product, supplier } = await seed();
  const created = await post(invoicesRoute, {
    supplierId: supplier.id, supplierInvoiceNumber: "PAY-3",
    items: [{ productId: product, quantityOrdered: 1, unitCost: 100 }],
  });
  const { invoice } = await body(created);
  // A zero amount is a malformed field, not a state conflict.
  assert.equal((await post(payRoute, { amount: 0 }, invoice.uuid)).status, 400);
});

test("the supplier balance reflects invoices less payments", async () => {
  const { product, supplier } = await seed();
  const created = await post(invoicesRoute, {
    supplierId: supplier.id, supplierInvoiceNumber: "BAL-1",
    items: [{ productId: product, quantityOrdered: 2, unitCost: 500 }],
  });
  const { invoice } = await body(created);
  await post(payRoute, { amount: 250 }, invoice.uuid);

  const res = await supplierRoute.GET({ headers: requestHeaders }, params(supplier.uuid));
  const { balance } = await body(res);
  assert.equal(balance.invoiced, 1000);
  assert.equal(balance.paid, 250);
  assert.equal(balance.outstanding, 750);
});

// ── cancellation ───────────────────────────────────────────────────────────

test("DELETE cancels an invoice that has received nothing", async () => {
  const { product, supplier } = await seed();
  const created = await post(invoicesRoute, {
    supplierId: supplier.id, supplierInvoiceNumber: "CXL-1",
    items: [{ productId: product, quantityOrdered: 5, unitCost: 10 }],
  });
  const { invoice } = await body(created);

  const res = await invoiceRoute.DELETE(
    { headers: requestHeaders, json: async () => ({ reason: "Duplicate of PI-2" }) },
    params(invoice.uuid)
  );
  assert.equal(res.status, 200);
  const { invoice: cancelled } = await body(res);
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.cancel_reason, "Duplicate of PI-2");
  assert.ok(cancelled.cancelled_at);
});

test("an invoice with received stock cannot be cancelled", async () => {
  const { res } = await bookAndReceive({ accepted: 10, label: "nocl" });
  const { invoice } = await body(res);
  const cancel = await invoiceRoute.DELETE(
    { headers: requestHeaders, json: async () => ({ reason: "changed mind" }) },
    params(invoice.uuid)
  );
  assert.equal(cancel.status, 422);
  assert.equal((await body(cancel)).code, "ALREADY_RECEIVED");
});

test("cancelling without a reason is refused", async () => {
  const { product, supplier } = await seed();
  const created = await post(invoicesRoute, {
    supplierId: supplier.id, supplierInvoiceNumber: "CXL-2",
    items: [{ productId: product, quantityOrdered: 1, unitCost: 1 }],
  });
  const { invoice } = await body(created);
  const res = await invoiceRoute.DELETE(
    { headers: requestHeaders, json: async () => ({}) }, params(invoice.uuid)
  );
  assert.equal(res.status, 400);
  assert.equal((await body(res)).code, "NO_REASON");
});

test("a cancelled invoice is retired-able again", async () => {
  const { product, supplier } = await seed();
  const created = await post(invoicesRoute, {
    supplierId: supplier.id, supplierInvoiceNumber: "CXL-3",
    items: [{ productId: product, quantityOrdered: 1, unitCost: 1 }],
  });
  const { invoice } = await body(created);
  await invoiceRoute.DELETE({ headers: requestHeaders, json: async () => ({ reason: "void" }) }, params(invoice.uuid));

  const res = await supplierRoute.DELETE({ headers: requestHeaders }, params(supplier.uuid));
  assert.equal(res.status, 200, "a cancelled invoice no longer blocks retirement");
});
// ── supplier bank accounts ─────────────────────────────────────────────────

const bankRoute = await import("../../app/api/suppliers/[id]/bank-accounts/route.js");
const bankItemRoute = await import("../../app/api/suppliers/[id]/bank-accounts/[uuid]/route.js");

const postItem = (fn, body, uuid, url) =>
  fn({ headers: requestHeaders, json: async () => body, url: url || "http://x" },
     { params: Promise.resolve({ uuid }) });

async function makeSupplier() {
  const res = await post(suppliersRoute, { name: `Bank Co ${++seq}` });
  assert.equal(res.status, 201);
  return (await body(res)).supplier;
}

const ACCOUNT = {
  account_name: "Sixteen Char Exports",
  bank_name: "HDFC Bank",
  account_number: "50100234567890",
  ifsc: "HDFC0001234",
  branch: "Pune Camp",
  account_type: "CURRENT",
};

test("a non-standard but alphanumeric IFSC is accepted", async () => {
  const supplier = await makeSupplier();
  // Eleven alphanumeric characters that are not the Indian IFSC layout. Saving is
  // allowed: refusing it would leave the supplier unpayable. Rejection belongs at
  // the payment gateway, not at data entry.
  const res = await post(bankRoute, { ...ACCOUNT, ifsc: "FD433424244" }, supplier.uuid);
  assert.equal(res.status, 201);
  assert.equal((await body(res)).account.ifsc, "FD433424244");

  // Punctuation and over-length are still refused.
  const bad = await post(bankRoute, { ...ACCOUNT, ifsc: "TOO-LONG-BANK-CODE" }, supplier.uuid);
  assert.equal(bad.status, 422);
});

test("a bank account is stored and returned masked", async () => {
  const supplier = await makeSupplier();
  const res = await post(bankRoute, ACCOUNT, supplier.uuid);
  assert.equal(res.status, 201);
  const { account } = await body(res);
  assert.equal(account.account_name, ACCOUNT.account_name);
  assert.equal(account.is_primary, true, "the first account is primary");
  // The full number never leaves the server on a create or a list.
  assert.equal(account.account_number, undefined, "the full number never leaves the server");
  // One dot per hidden digit, so the length is visible but the number is not.
  assert.equal(
    account.account_number_masked,
    "\u2022".repeat(ACCOUNT.account_number.length - 4) + "7890"
  );
});

test("an account number pasted with spaces or dashes is accepted", async () => {
  const supplier = await makeSupplier();
  const res = await post(bankRoute, { ...ACCOUNT, account_number: "50100 23456-7890" }, supplier.uuid);
  assert.equal(res.status, 201);
  assert.equal(
    (await body(res)).account.account_number_masked,
    "\u2022".repeat(ACCOUNT.account_number.length - 4) + "7890"
  );
});

test("a bad account number, IFSC or missing field is refused with the reason", async () => {
  const supplier = await makeSupplier();
  const cases = [
    [{ ...ACCOUNT, account_number: "12" }, /6 to 20 digits/],
    [{ ...ACCOUNT, ifsc: "NOPE/123" }, /letters and numbers/i],
    [{ ...ACCOUNT, account_name: "" }, /Enter a name/],
    [{ ...ACCOUNT, bank_name: "" }, /bank name/],
    [{ ...ACCOUNT, account_number: "" }, /account number/],
  ];
  for (const [payload, pattern] of cases) {
    const res = await post(bankRoute, payload, supplier.uuid);
    assert.equal(res.status, 422, `expected 422 for ${JSON.stringify(payload.account_number)}`);
    assert.match((await body(res)).message, pattern);
  }
});

test("listing returns every account masked, primary first", async () => {
  const supplier = await makeSupplier();
  await post(bankRoute, ACCOUNT, supplier.uuid);
  await post(bankRoute, { ...ACCOUNT, account_name: "Second", ifsc: "ICIC0000001" }, supplier.uuid);

  const res = await bankRoute.GET({ headers: requestHeaders, url: "http://x" },
    { params: Promise.resolve({ id: supplier.uuid }) });
  assert.equal(res.status, 200);
  const { accounts } = await body(res);
  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].is_primary, true);
  assert.ok(accounts[0].account_number_masked.endsWith("7890"));
  assert.equal(accounts[0].account_number, undefined);
  assert.equal(accounts[1].is_primary, false);
});

test("setting a primary demotes the old one in the same transaction", async () => {
  const supplier = await makeSupplier();
  const first = (await body(await post(bankRoute, ACCOUNT, supplier.uuid))).account;
  const second = (await body(await post(bankRoute, { ...ACCOUNT, account_name: "Second" }, supplier.uuid))).account;

  const res = await postItem(bankItemRoute.POST, {}, second.uuid,
    "http://x/api/suppliers/1/bank-accounts/x?action=primary");
  assert.equal(res.status, 200);
  assert.equal((await body(res)).account.is_primary, true);

  const listed = (await body(await bankRoute.GET({ headers: requestHeaders, url: "http://x" },
    { params: Promise.resolve({ id: supplier.uuid }) }))).accounts;
  assert.equal(listed.filter((a) => a.is_primary).length, 1, "never two primaries");
  assert.equal(listed.find((a) => a.uuid === first.uuid).is_primary, false);
  assert.equal(listed.find((a) => a.uuid === second.uuid).is_primary, true);
});

test("a PATCH cannot smuggle in is_primary", async () => {
  const supplier = await makeSupplier();
  const first = (await body(await post(bankRoute, ACCOUNT, supplier.uuid))).account;
  const second = (await body(await post(bankRoute, { ...ACCOUNT, account_name: "Second" }, supplier.uuid))).account;

  const res = await bankItemRoute.PATCH(
    { headers: requestHeaders, json: async () => ({ is_primary: true }) },
    { params: Promise.resolve({ uuid: second.uuid }) }
  );
  assert.equal(res.status, 200);
  assert.equal((await body(res)).account.is_primary, false, "primary only moves via its own action");
  assert.equal((await body(await bankRoute.GET({ headers: requestHeaders, url: "http://x" },
    { params: Promise.resolve({ id: supplier.uuid }) }))).accounts
    .find((a) => a.uuid === first.uuid).is_primary, true);
});

test("editing an account works and keeps it masked", async () => {
  const supplier = await makeSupplier();
  const account = (await body(await post(bankRoute, ACCOUNT, supplier.uuid))).account;
  const res = await bankItemRoute.PATCH(
    { headers: requestHeaders, json: async () => ({ branch: "Koregaon Park" }) },
    { params: Promise.resolve({ uuid: account.uuid }) }
  );
  assert.equal(res.status, 200);
  const updated = (await body(res)).account;
  assert.equal(updated.branch, "Koregaon Park");
  assert.equal(updated.account_number, undefined);
});

test("the only active account cannot be retired", async () => {
  const supplier = await makeSupplier();
  const account = (await body(await post(bankRoute, ACCOUNT, supplier.uuid))).account;
  const res = await bankItemRoute.DELETE({ headers: requestHeaders },
    { params: Promise.resolve({ uuid: account.uuid }) });
  assert.equal(res.status, 422);
  assert.match((await body(res)).message, /only active account/);
});

test("an account can be retired once another is primary", async () => {
  const supplier = await makeSupplier();
  const first = (await body(await post(bankRoute, ACCOUNT, supplier.uuid))).account;
  const second = (await body(await post(bankRoute, { ...ACCOUNT, account_name: "Second" }, supplier.uuid))).account;
  await postItem(bankItemRoute.POST, {}, second.uuid,
    "http://x/api/suppliers/1/bank-accounts/x?action=primary");

  const res = await bankItemRoute.DELETE({ headers: requestHeaders },
    { params: Promise.resolve({ uuid: first.uuid }) });
  assert.equal(res.status, 200);
  assert.equal((await body(res)).account.is_active, false);
});

test("bank routes 404 for a supplier that does not exist", async () => {
  const res = await bankRoute.GET({ headers: requestHeaders, url: "http://x" },
    { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }) });
  assert.equal(res.status, 404);
});

test("a malformed uuid is rejected before any query", async () => {
  const res = await bankRoute.GET({ headers: requestHeaders, url: "http://x" },
    { params: Promise.resolve({ id: "nope" }) });
  assert.equal(res.status, 404);
});
