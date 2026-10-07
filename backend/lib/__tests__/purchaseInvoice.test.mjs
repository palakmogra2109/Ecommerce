import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { loadEnv } from "../../scripts/lib/env.mjs";

await loadEnv();

// The models bind a pool at import time from process.env.DATABASE_URL, so it is
// pointed at a throwaway database BEFORE they are imported. Nothing here may
// touch the live `ecommerce` database.
const base = process.env.DATABASE_URL.replace(/\/[^/]*$/, "/");
const admin = new pg.Pool({ connectionString: base + "postgres" });
const SCRATCH = "gc_purchase_svc";
await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH}`);
await admin.query(`CREATE DATABASE ${SCRATCH}`);
await admin.end();
process.env.DATABASE_URL = base + SCRATCH;

const { PurchaseInvoice, computeLineTotals, computeInvoiceTotals, deriveStatus,
        PurchaseError, INVOICE_STATUS, PAYMENT_STATUS } =
  await import("../services/purchaseInvoice.js");
const servicePool = (await import("../db.js")).default;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(fs.readFileSync("sql/schema.sql", "utf8"));

let seq = 0;
async function seed({ stock = 0 } = {}) {
  seq += 1;
  const product = (
    await pool.query(
      "INSERT INTO products (name,slug,sku,price,stock,status) VALUES ($1,$2,$3,100,$4,'ACTIVE') RETURNING id",
      [`Widget ${seq}`, `widget-${seq}`, `SKU-${seq}`, stock]
    )
  ).rows[0];
  const supplier = (
    await pool.query("INSERT INTO suppliers (name,email) VALUES ($1,$2) RETURNING id",
      [`Supplier ${seq}`, `s${seq}@example.test`])
  ).rows[0];
  return { product: product.id, supplier: supplier.id };
}

const items = (productId, quantityOrdered = 10, unitCost = 100) => [
  { productId, quantityOrdered, unitCost },
];

test.after(async () => {
  await pool.end();
  // The service imported its own pool at module load; both point at the scratch
  // database and both must be closed before it can be dropped.
  await servicePool.end().catch(() => {});
  const a = new pg.Pool({ connectionString: base + "postgres" });
  await a.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  await a.end();
});

// ── pure arithmetic ────────────────────────────────────────────────────────

test("a line discounts before taxing", () => {
  const r = computeLineTotals({ quantityOrdered: 10, unitCost: 100, discountPercent: 10, taxPercent: 18 });
  assert.equal(r.gross, 1000);
  assert.equal(r.discountAmount, 100);
  assert.equal(r.taxAmount, 162);      // 18% of 900, not of 1000
  assert.equal(r.lineTotal, 1062);
});

test("the header total equals the sum of the lines", () => {
  const lines = [
    computeLineTotals({ quantityOrdered: 10, unitCost: 100, taxPercent: 18 }),
    computeLineTotals({ quantityOrdered: 3, unitCost: 55.5 }),
  ];
  const t = computeInvoiceTotals(lines, { shippingTotal: 40 });
  assert.equal(t.subtotal, 1166.5);
  assert.equal(t.taxTotal, 180);
  assert.equal(t.totalAmount, round2(1166.5 + 180 + 40));
});

test("status rolls up from receipt progress", () => {
  const ord = (received, damaged = 0) => ({
    quantity_ordered: 10, quantity_received: received, quantity_damaged: damaged,
    quantity_rejected: 0,
  });
  assert.equal(deriveStatus([ord(0)]), INVOICE_STATUS.AWAITING_STOCK);
  assert.equal(deriveStatus([ord(5)]), INVOICE_STATUS.PARTIALLY_RECEIVED);
  assert.equal(deriveStatus([ord(10)]), INVOICE_STATUS.RECEIVED);
  // Damaged stock counts against the order even though it never becomes sellable.
  assert.equal(deriveStatus([ord(5, 5)]), INVOICE_STATUS.RECEIVED);
});

function round2(n) { return Math.round(n * 100) / 100; }

// ── creation ───────────────────────────────────────────────────────────────

test("creates a draft invoice with a server-side number and computed totals", async () => {
  const { product, supplier } = await seed();
  const inv = await PurchaseInvoice.create({
    supplierId: supplier,
    supplierInvoiceNumber: "SUP-1001",
    items: items(product, 10, 100),
    shippingTotal: 50,
  });
  assert.match(inv.invoice_number, /^PI-\d{6}$/);
  assert.equal(inv.status, INVOICE_STATUS.AWAITING_STOCK);
  assert.equal(inv.payment_status, PAYMENT_STATUS.UNPAID);
  assert.equal(inv.subtotal, 1000);
  assert.equal(inv.total_amount, 1050);
  assert.equal(inv.items.length, 1);
  // Nothing has physically arrived, so stock must not have moved.
  const p = await pool.query("SELECT stock FROM products WHERE id=$1", [product]);
  assert.equal(p.rows[0].stock, 0);
});

test("two invoices for the same supplier number are refused", async () => {
  const { product, supplier } = await seed();
  await PurchaseInvoice.create({ supplierId: supplier, supplierInvoiceNumber: "DUP-1", items: items(product) });
  await assert.rejects(
    () => PurchaseInvoice.create({ supplierId: supplier, supplierInvoiceNumber: "DUP-1", items: items(product) }),
    (e) => e instanceof PurchaseError && e.code === "DUPLICATE_INVOICE_NUMBER"
  );
});

test("the SAME number under a different supplier is allowed", async () => {
  const { product, supplier } = await seed();
  const other = (await pool.query("INSERT INTO suppliers (name) VALUES ('Other') RETURNING id")).rows[0].id;
  await PurchaseInvoice.create({ supplierId: supplier, supplierInvoiceNumber: "SHARED", items: items(product) });
  const second = await PurchaseInvoice.create({ supplierId: other, supplierInvoiceNumber: "SHARED", items: items(product) });
  assert.ok(second.id);
});

test("money is recomputed, not taken from the caller", async () => {
  const { product, supplier } = await seed();
  // A crafted total that disagrees with the lines must be ignored.
  const inv = await PurchaseInvoice.create({
    supplierId: supplier, supplierInvoiceNumber: "X-1",
    items: [{ productId: product, quantityOrdered: 10, unitCost: 100, lineTotal: 1, total_amount: 1 }],
  });
  assert.equal(inv.total_amount, 1000);
});

test("bad lines are refused with a reason, not a constraint error", async () => {
  const { product, supplier } = await seed();
  const cases = [
    [[], "EMPTY"],
    [[{ productId: product, quantityOrdered: 0, unitCost: 5 }], "BAD_QUANTITY"],
    [[{ productId: product, quantityOrdered: 1, unitCost: -1 }], "BAD_COST"],
    [[{ quantityOrdered: 1, unitCost: 1 }], "NEEDS_PRODUCT"],
    [[{ productId: 999999, quantityOrdered: 1, unitCost: 1 }], "UNKNOWN_ITEM"],
  ];
  for (const [bad, code] of cases) {
    await assert.rejects(
      () => PurchaseInvoice.create({ supplierId: supplier, supplierInvoiceNumber: "B-" + code, items: bad }),
      (e) => e.code === code,
      `expected ${code}`
    );
  }
});

// ── receiving stock ─────────────────────────────────────────────────────────

test("a partial receipt adds only the accepted quantity to stock", async () => {
  const { product, supplier } = await seed({ stock: 100 });
  const inv = await PurchaseInvoice.create({ supplierId: supplier, supplierInvoiceNumber: "R-1", items: items(product, 100, 50) });
  const itemId = inv.items[0].id;

  const res = await PurchaseInvoice.receiveStock({
    invoiceId: inv.id,
    lines: [{ purchaseInvoiceItemId: itemId, accepted: 80, damaged: 0, missing: 20 }],
  });
  // 80 received plus 20 written off as missing fully closes the order, so the
  // invoice is settled even though only 80 units became sellable.
  assert.equal(res.status, INVOICE_STATUS.RECEIVED);
  assert.equal(res.receipt.receipt_number, "GR-000001");
  assert.equal(res.receipt.total_accepted, 80);
  assert.equal(res.receipt.total_missing, 20);

  const p = await pool.query("SELECT stock FROM products WHERE id=$1", [product]);
  assert.equal(p.rows[0].stock, 180, "100 existing + 80 accepted; the 20 missing never lands");
  assert.equal(res.invoice.items[0].quantity_received, 80);
});

test("a receipt that leaves stock outstanding stays PARTIALLY_RECEIVED", async () => {
  const { product, supplier } = await seed();
  const inv = await PurchaseInvoice.create({ supplierId: supplier, supplierInvoiceNumber: "P-9", items: items(product, 100, 10) });
  const res = await PurchaseInvoice.receiveStock({
    invoiceId: inv.id, lines: [{ purchaseInvoiceItemId: inv.items[0].id, accepted: 40 }],
  });
  assert.equal(res.status, INVOICE_STATUS.PARTIALLY_RECEIVED);
  const p = await pool.query("SELECT stock FROM products WHERE id=$1", [product]);
  assert.equal(p.rows[0].stock, 40);
});

test("damaged stock is recorded but is not sellable", async () => {
  const { product, supplier } = await seed({ stock: 0 });
  const inv = await PurchaseInvoice.create({ supplierId: supplier, supplierInvoiceNumber: "D-1", items: items(product, 10, 20) });
  const res = await PurchaseInvoice.receiveStock({
    invoiceId: inv.id,
    lines: [{ purchaseInvoiceItemId: inv.items[0].id, accepted: 7, damaged: 3 }],
  });
  assert.equal(res.receipt.total_damaged, 3);
  const p = await pool.query("SELECT stock FROM products WHERE id=$1", [product]);
  assert.equal(p.rows[0].stock, 7, "only the accepted 7 is sellable");
  assert.equal(res.invoice.items[0].quantity_damaged, 3);
});

test("receiving the balance completes the invoice", async () => {
  const { product, supplier } = await seed();
  const inv = await PurchaseInvoice.create({ supplierId: supplier, supplierInvoiceNumber: "F-1", items: items(product, 10, 20) });
  const id = inv.items[0].id;
  await PurchaseInvoice.receiveStock({ invoiceId: inv.id, lines: [{ purchaseInvoiceItemId: id, accepted: 6 }] });
  const res = await PurchaseInvoice.receiveStock({ invoiceId: inv.id, lines: [{ purchaseInvoiceItemId: id, accepted: 4 }] });
  assert.equal(res.status, INVOICE_STATUS.RECEIVED);
  const p = await pool.query("SELECT stock FROM products WHERE id=$1", [product]);
  assert.equal(p.rows[0].stock, 10);
});

test("over-receipt is refused and leaves stock untouched", async () => {
  const { product, supplier } = await seed();
  const inv = await PurchaseInvoice.create({ supplierId: supplier, supplierInvoiceNumber: "O-1", items: items(product, 10, 20) });
  const id = inv.items[0].id;
  await PurchaseInvoice.receiveStock({ invoiceId: inv.id, lines: [{ purchaseInvoiceItemId: id, accepted: 8 }] });
  await assert.rejects(
    () => PurchaseInvoice.receiveStock({ invoiceId: inv.id, lines: [{ purchaseInvoiceItemId: id, accepted: 5 }] }),
    (e) => e.code === "OVER_RECEIPT"
  );
  const p = await pool.query("SELECT stock FROM products WHERE id=$1", [product]);
  assert.equal(p.rows[0].stock, 8, "the refused receipt changed nothing");
});

test("a rejected receipt writes no ledger row and no stock change", async () => {
  const { product, supplier } = await seed();
  const inv = await PurchaseInvoice.create({ supplierId: supplier, supplierInvoiceNumber: "A-1", items: items(product, 10, 20) });
  const id = inv.items[0].id;
  // Second line is bad; the first is valid, so this proves the whole receipt rolls back.
  await assert.rejects(() => PurchaseInvoice.receiveStock({
    invoiceId: inv.id,
    lines: [
      { purchaseInvoiceItemId: id, accepted: 5 },
      { purchaseInvoiceItemId: id, accepted: 99 },
    ],
  }));
  const p = await pool.query("SELECT stock FROM products WHERE id=$1", [product]);
  assert.equal(p.rows[0].stock, 0, "all-or-nothing: the valid line did not land either");
  const led = await pool.query("SELECT count(*)::int n FROM stock_ledger WHERE product_id=$1", [product]);
  assert.equal(led.rows[0].n, 0, "no ledger row without its stock change");
  const rec = await pool.query(
    "SELECT count(*)::int n FROM stock_receipts WHERE purchase_invoice_id=$1", [inv.id]);
  assert.equal(rec.rows[0].n, 0, "no orphan receipt");
});

test("every receipt writes a ledger row carrying previous and new stock", async () => {
  const { product, supplier } = await seed({ stock: 40 });
  const inv = await PurchaseInvoice.create({ supplierId: supplier, supplierInvoiceNumber: "L-1", items: items(product, 10, 20) });
  await PurchaseInvoice.receiveStock({ invoiceId: inv.id, lines: [{ purchaseInvoiceItemId: inv.items[0].id, accepted: 10 }] });
  const led = await pool.query("SELECT * FROM stock_ledger WHERE product_id=$1", [product]);
  assert.equal(led.rows.length, 1);
  assert.equal(Number(led.rows[0].previous_stock), 40);
  assert.equal(Number(led.rows[0].new_stock), 50);
  assert.equal(led.rows[0].transaction_type, "PURCHASE_RECEIPT");
  assert.equal(led.rows[0].performed_by, null);
});

// ── payments ───────────────────────────────────────────────────────────────

test("payments in instalments track the outstanding balance", async () => {
  const { product, supplier } = await seed();
  const inv = await PurchaseInvoice.create({ supplierId: supplier, supplierInvoiceNumber: "P-1", items: items(product, 10, 2000) });
  assert.equal(inv.total_amount, 20000);

  const first = await PurchaseInvoice.recordPayment({ invoiceId: inv.id, amount: 10000 });
  assert.equal(first.outstanding, 10000);
  assert.equal(first.invoice.payment_status, PAYMENT_STATUS.PARTIALLY_PAID);

  const second = await PurchaseInvoice.recordPayment({ invoiceId: inv.id, amount: 5000 });
  assert.equal(second.outstanding, 5000);

  const last = await PurchaseInvoice.recordPayment({ invoiceId: inv.id, amount: 5000 });
  assert.equal(last.outstanding, 0);
  assert.equal(last.invoice.payment_status, PAYMENT_STATUS.PAID);
  assert.equal(last.invoice.payments.length, 3);
});

test("paying more than is outstanding is refused", async () => {
  const { product, supplier } = await seed();
  const inv = await PurchaseInvoice.create({ supplierId: supplier, supplierInvoiceNumber: "P-2", items: items(product, 10, 100) });
  await assert.rejects(
    () => PurchaseInvoice.recordPayment({ invoiceId: inv.id, amount: 1001 }),
    (e) => e.code === "OVER_PAYMENT"
  );
  const fresh = await PurchaseInvoice.findById(inv.id);
  assert.equal(fresh.payments.length, 0, "the refused payment left no row");
  assert.equal(fresh.outstanding, 1000);
});

test("a zero or negative payment is refused", async () => {
  const { product, supplier } = await seed();
  const inv = await PurchaseInvoice.create({ supplierId: supplier, supplierInvoiceNumber: "P-3", items: items(product, 10, 100) });
  await assert.rejects(() => PurchaseInvoice.recordPayment({ invoiceId: inv.id, amount: 0 }));
  await assert.rejects(() => PurchaseInvoice.recordPayment({ invoiceId: inv.id, amount: -50 }));
});

test("an unknown payment method is refused", async () => {
  const { product, supplier } = await seed();
  const inv = await PurchaseInvoice.create({ supplierId: supplier, supplierInvoiceNumber: "P-4", items: items(product, 10, 100) });
  await assert.rejects(
    () => PurchaseInvoice.recordPayment({ invoiceId: inv.id, amount: 10, method: "CRYPTO" }),
    (e) => e.code === "BAD_PAYMENT_METHOD"
  );
});

test("a payment never touches stock", async () => {
  const { product, supplier } = await seed({ stock: 11 });
  const inv = await PurchaseInvoice.create({ supplierId: supplier, supplierInvoiceNumber: "P-5", items: items(product, 10, 100) });
  await PurchaseInvoice.recordPayment({ invoiceId: inv.id, amount: 500 });
  const p = await pool.query("SELECT stock FROM products WHERE id=$1", [product]);
  assert.equal(p.rows[0].stock, 11);
  const led = await pool.query("SELECT count(*)::int n FROM stock_ledger WHERE product_id=$1", [product]);
  assert.equal(led.rows[0].n, 0, "payments are separate from stock movements");
});

// ── selling price is owned by the purchase invoice ──────────────────────────

test("receiving a PO sets stock AND the selling price on the product", async () => {
  const { product, supplier } = await seed();
  const before = (await pool.query("SELECT price, stock FROM products WHERE id=$1", [product])).rows[0];
  assert.equal(Number(before.price), 100, "seed price before any purchase");

  const inv = await PurchaseInvoice.create({
    supplierId: supplier, supplierInvoiceNumber: "SP-1",
    items: [{ productId: product, quantityOrdered: 10, unitCost: 80, sellingPrice: 120 }],
  });
  assert.equal(inv.items[0].selling_price, 120, "the line records the selling price");

  await PurchaseInvoice.receiveStock({
    invoiceId: inv.id,
    lines: [{ purchaseInvoiceItemId: inv.items[0].id, accepted: 10 }],
  });

  const after = (await pool.query("SELECT price, stock FROM products WHERE id=$1", [product])).rows[0];
  assert.equal(Number(after.stock), 10);
  assert.equal(Number(after.price), 120, "the retail price came from the purchase, not the cost");
});

test("unit_cost is the cost and never becomes the selling price", async () => {
  const { product, supplier } = await seed();
  const inv = await PurchaseInvoice.create({
    supplierId: supplier, supplierInvoiceNumber: "SP-2",
    items: [{ productId: product, quantityOrdered: 5, unitCost: 200, sellingPrice: 350 }],
  });
  const item = inv.items[0];
  assert.equal(Number(item.unit_cost), 200, "cost preserved");
  assert.equal(Number(item.selling_price), 350, "price set separately, so margin survives");
});

test("a purchase with no selling price leaves the existing price alone", async () => {
  const { product, supplier } = await seed();
  await pool.query("UPDATE products SET price = 99 WHERE id = $1", [product]);

  const inv = await PurchaseInvoice.create({
    supplierId: supplier, supplierInvoiceNumber: "SP-3",
    items: [{ productId: product, quantityOrdered: 5, unitCost: 10 }],
  });
  assert.equal(inv.items[0].selling_price, null, "absent means 'did not reprice'");

  await PurchaseInvoice.receiveStock({
    invoiceId: inv.id,
    lines: [{ purchaseInvoiceItemId: inv.items[0].id, accepted: 5 }],
  });
  const after = (await pool.query("SELECT price FROM products WHERE id=$1", [product])).rows[0];
  assert.equal(Number(after.price), 99, "price untouched, stock still moved");
});

test("a negative selling price is refused", async () => {
  const { product, supplier } = await seed();
  await assert.rejects(
    () => PurchaseInvoice.create({
      supplierId: supplier, supplierInvoiceNumber: "SP-4",
      items: [{ productId: product, quantityOrdered: 1, unitCost: 5, sellingPrice: -1 }],
    }),
    (e) => e.code === "BAD_COST"
  );
});

test("the product API ignores a price or stock sent in the request", async () => {
  const { supplier } = await seed();
  const created = await PurchaseInvoice.create({
    supplierId: supplier, supplierInvoiceNumber: "SP-5",
    items: [{ productId: (await seed()).product, quantityOrdered: 1, unitCost: 5 }],
  });
  assert.ok(created.id);

  // Defence in depth behind the form: even a crafted body cannot set them.
  const p = (await pool.query("SELECT id FROM products ORDER BY id DESC LIMIT 1")).rows[0].id;
  await pool.query("UPDATE products SET price = 500, stock = 777 WHERE id = $1", [p]);
  await pool.query("SELECT 1"); // no-op, keeps the pool warm
  const { Product } = await import("../models/product.js");
  const updated = await Product.update((await pool.query("SELECT uuid FROM products WHERE id=$1", [p])).rows[0].uuid,
    { price: 1, stock: 2, name: "Renamed" });
  const row = (await pool.query("SELECT price, stock, name FROM products WHERE id=$1", [p])).rows[0];
  assert.equal(row.name, "Renamed", "the legitimate edit still applied");
  assert.equal(Number(row.price), 500, "price ignored");
  assert.equal(Number(row.stock), 777, "stock ignored");
});
