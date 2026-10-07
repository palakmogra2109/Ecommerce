import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { loadEnv } from "../../scripts/lib/env.mjs";
import "./helpers/aliasHooks.mjs";
import { mergeVariants } from "../services/productVariants.js";
import { PurchaseInvoice } from "../services/purchaseInvoice.js";

await loadEnv();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// The Rajma scenario from the specification. Everything runs inside one
// transaction that is always rolled back, so the live catalog is never touched:
// Rajma, its 9 variants, ABC Supplier, both invoices, the batches and the
// ledger all disappear when the test ends.
test("Rajma: one invoice, 9 variants of the same product, batches + ledger + price history", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── arrange: a product with 2 attributes → 9 combinations ────────────────
    const attributes = [
      { name: "Color", values: ["White", "Maroon", "Black"] },
      { name: "Pack Size", values: ["500g", "2KG", "10KG"] },
    ];
    const variants = mergeVariants([], attributes, { sku: "RAJMA", name: "Rajma" });
    assert.equal(variants.length, 9);

    const { rows: [prod] } = await client.query(
      `INSERT INTO products (name, slug, sku, variants, attributes, status, inventory_mode, stock)
       VALUES ('Rajma', 'rajma', 'RAJMA', $1::jsonb, $2::jsonb, 'ACTIVE', 'PER_SKU', 0)
       RETURNING id, uuid`,
      [JSON.stringify(variants), JSON.stringify(attributes)]
    );

    const { rows: [sup] } = await client.query(
      `INSERT INTO suppliers (name, email, is_active) VALUES ('ABC Supplier', 'rajma-test@example.test', true) RETURNING id`
    );
    const { rows: [wh] } = await client.query(
      `SELECT id FROM branches ORDER BY id LIMIT 1`
    );

    const byKey = (color, size) =>
      variants.find((v) => v.attributes.Color === color && v.attributes["Pack Size"] === size);

    // ── the 9 lines from section 34 ──────────────────────────────────────────
    const spec = [
      ["White", "500g", 100, 50], ["White", "2KG", 50, 180], ["White", "10KG", 20, 800],
      ["Maroon", "500g", 100, 60], ["Maroon", "2KG", 50, 220], ["Maroon", "10KG", 20, 950],
      ["Black", "500g", 100, 55], ["Black", "2KG", 50, 200], ["Black", "10KG", 20, 900],
    ];

    const items = spec.map(([color, size, qty, price]) => {
      const v = byKey(color, size);
      return {
        productId: prod.id,
        variantUuid: v.uuid,
        sku: v.sku,
        name: v.name,
        quantityOrdered: qty,
        unitCost: price,
      };
    });

    // All 9 lines belong to ONE product — this is what used to be rejected.
    const invoice = await PurchaseInvoice.create(
      {
        supplierId: sup.id,
        supplierInvoiceNumber: "INV-001",
        invoiceDate: "2026-01-01",
        items,
        warehouseId: wh.id,
        createdBy: null,
      },
      client
    );

    assert.equal(invoice.id != null, true, "one invoice was created");

    // ── assert: one invoice, nine lines, each variant identified ─────────────
    const { rows: lineRows } = await client.query(
      `SELECT id, variant_uuid, sku, quantity_ordered, unit_cost
         FROM purchase_invoice_items WHERE purchase_invoice_id = $1 ORDER BY line_no`,
      [invoice.id]
    );
    assert.equal(lineRows.length, 9, "9 lines on the single invoice");
    assert.equal(new Set(lineRows.map((r) => r.variant_uuid)).size, 9, "9 distinct variants");
    assert.equal(
      (await client.query(`SELECT count(*)::int n FROM purchase_invoices WHERE id = $1`, [invoice.id])).rows[0].n,
      1,
      "exactly ONE invoice exists"
    );

    // ── receive everything → batches + ledger ────────────────────────────────
    const received = await PurchaseInvoice.receiveStock(
      {
        invoiceId: invoice.id,
        lines: lineRows.map((r, i) => ({
          purchaseInvoiceItemId: r.id,
          accepted: spec[i][2],
          quantityDamaged: 0,
          unitCost: spec[i][3],
        })),
        performedBy: null,
      },
      client
    ).catch((e) => { console.error("RECEIVE-ERROR:", e.message); return { skipped: e.message }; });

    // Receiving may key on item id in the real flow; assert on whatever landed.
    const { rows: batchRows } = await client.query(
      `SELECT variant_uuid, quantity_received, cost_price FROM product_batches WHERE purchase_invoice_id = $1`,
      [invoice.id]
    );
    const { rows: ledgerRows } = await client.query(
      `SELECT variant_uuid, quantity, transaction_type FROM stock_ledger
        WHERE reference_type = 'STOCK_RECEIPT'
          AND reference_id IN (SELECT id FROM stock_receipts WHERE purchase_invoice_id = $1)`,
      [invoice.id]
    );

    assert.equal(batchRows.length, 9, `9 batches created (got ${batchRows.length})`);
    assert.equal(new Set(batchRows.map((r) => r.variant_uuid)).size, 9,
      "each batch tracks a distinct variant");
    assert.equal(ledgerRows.length, 9, `9 ledger entries (got ${ledgerRows.length})`);
    assert.ok(ledgerRows.every((r) => r.transaction_type === "PURCHASE_RECEIPT"));
    assert.equal(new Set(ledgerRows.map((r) => r.variant_uuid)).size, 9,
      "each variant has its own ledger row");

    // ── assert: ledger keeps each variant's quantity independent ────────────
    const white2kgUuid = byKey("White", "2KG").uuid;
    const ledgerForWhite2kg = ledgerRows.filter((r) => r.variant_uuid === white2kgUuid);
    assert.equal(ledgerForWhite2kg.length, 1);
    assert.equal(Number(ledgerForWhite2kg[0].quantity), 50,
      "White / 2KG received 50, independent of the other 8 variants");

    // The new variant-level stock view now reflects the received batches.
    const { rows: levels } = await client.query(
      `SELECT variant_uuid, quantity_available FROM product_variant_stock_levels WHERE product_id = $1`, [prod.id]
    );
    assert.equal(levels.length, 9, "variant stock view has one row per variant");
    const white2kgStock = levels.find((r) => r.variant_uuid === byKey("White", "2KG").uuid);
    assert.equal(Number(white2kgStock.quantity_available), 50,
      "White / 2KG available is independent of the other variants");

    // ── assert: second invoice keeps the old price in history ───────────────
    const second = await PurchaseInvoice.create(
      {
        supplierId: sup.id,
        supplierInvoiceNumber: "INV-002",
        invoiceDate: "2026-02-15",
        items: [{
          productId: prod.id,
          variantUuid: byKey("White", "2KG").uuid,
          sku: byKey("White", "2KG").sku,
          name: byKey("White", "2KG").name,
          quantityOrdered: 50,
          unitCost: 195,
        }],
        warehouseId: wh.id,
      },
      client
    );

    const { rows: history } = await client.query(
      `SELECT unit_cost FROM purchase_invoice_items
        WHERE product_id = $1 AND variant_uuid = $2 ORDER BY id`,
      [prod.id, byKey("White", "2KG").uuid]
    );
    assert.equal(history.length, 2, "both prices retained for the same variant");
    assert.deepEqual(history.map((h) => Number(h.unit_cost)), [180, 195]);
    assert.notEqual(second.id, invoice.id);

    // ── assert: duplicate lines still refused ───────────────────────────────
    await assert.rejects(
      () => PurchaseInvoice.create(
        {
          supplierId: sup.id,
          supplierInvoiceNumber: "INV-003",
          invoiceDate: "2026-03-01",
          items: [
            { productId: prod.id, variantUuid: byKey("White", "2KG").uuid, quantityOrdered: 1, unitCost: 1 },
            { productId: prod.id, variantUuid: byKey("White", "2KG").uuid, quantityOrdered: 2, unitCost: 2 },
          ],
        },
        client
      ),
      /twice/i
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test.after(async () => {
  await pool.end();
});