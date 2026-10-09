// Assign a real uuid to every product variant that lacks one, and repair the
// variant_uuid values that were written as SKUs.
//
// WHY THIS EXISTS
//
// mergeVariants() backfills a uuid through ensureIdentity(), so variants created
// or edited through the product form always had one. Rows that predate that —
// seeded straight into products.variants — never did. Those variants had no
// stable identity, so the purchase form fell back to `v.uuid || v.sku` and
// posted a SKU into the variant_uuid column. purchaseInvoice.js stores that
// value verbatim and writes it to warehouse_inventory.variant_uuid on receipt,
// and the variant-level stock view joins on e->>'uuid' = b.variant_uuid, so a
// SKU in that column silently produces a stock row attributed to no variant at
// all.
//
// USAGE
//
//   node scripts/backfill-variant-uuids.mjs            report only (default)
//   node scripts/backfill-variant-uuids.mjs --apply    write the changes
//
// Report mode is the default because this edits live catalogue data. Both modes
// are idempotent: a second run reports zero changes.

import { randomUUID } from "node:crypto";
import { withPool } from "./lib/pool.mjs";

const APPLY = process.argv.includes("--apply");

/**
 * Identity for a variant, most trustworthy first.
 *
 * sku is preferred over the attribute combination because it is what an operator
 * typed deliberately and what they will look the variant up by. The attribute
 * key is the fallback for a variant carrying neither.
 */
function variantIdentity(variant) {
  const sku = typeof variant.sku === "string" ? variant.sku.trim() : "";
  if (sku) return { kind: "sku", value: sku.toUpperCase() };

  const attrs = variant.attributes;
  if (attrs && typeof attrs === "object") {
    const key = Object.keys(attrs)
      .sort()
      .map((k) => `${k.trim().toUpperCase()}=${String(attrs[k]).trim().toUpperCase()}`)
      .join("|");
    if (key) return { kind: "attributes", value: key };
  }

  return null;
}

/** The uuid this variant should have, or null when it already has one. */
function uuidFor(variant) {
  return typeof variant.uuid === "string" && variant.uuid.trim() ? variant.uuid.trim() : null;
}

export async function planBackfill(pool) {
  const { rows } = await pool.query(
    `SELECT id, name, COALESCE(variants, '[]'::jsonb) AS variants
     FROM products
     WHERE jsonb_array_length(COALESCE(variants, '[]'::jsonb)) > 0
     ORDER BY name`
  );

  const products = [];
  let missing = 0;

  for (const row of rows) {
    const variants = Array.isArray(row.variants) ? row.variants : [];

    // Seen inside this product only. The same SKU can legitimately exist under
    // two different products, so identity is never global.
    //
    // Seeded from the variants that ALREADY have a uuid, not from all of them.
    // Seeding from every variant would make each one match its own identity and
    // the whole backfill would report zero changes — which it did, until this
    // was narrowed.
    const taken = new Set();
    for (const v of variants) {
      if (!v || typeof v !== "object" || !uuidFor(v)) continue;
      const id = variantIdentity(v);
      if (id) taken.add(`${id.kind}:${id.value}`);
    }

    const changes = [];
    let productChanged = false;

    const next = variants.map((variant) => {
      if (!variant || typeof variant !== "object") return variant;

      const existing = uuidFor(variant);
      if (existing) return variant;

      const identity = variantIdentity(variant);
      if (!identity) return variant; // Nothing to key on; reported, not touched.

      // Two variants in one product claiming the same identity would make the
      // repair ambiguous — the repair could point both at one variant.
      const key = `${identity.kind}:${identity.value}`;
      if (taken.has(key)) return variant;

      const uuid = randomUUID();
      taken.add(key);
      missing += 1;
      productChanged = true;
      changes.push({
        from: null,
        to: uuid,
        matchedOn: `${identity.kind} ${identity.value}`,
        label: variant.name || variant.sku || "(unnamed)",
      });

      return { ...variant, uuid };
    });

    if (productChanged) {
      products.push({ id: row.id, name: row.name, changes, next });
    }
  }

  return { products, missing };
}

/**
 * Repair variant_uuid columns that hold a variant's SKU rather than its uuid.
 *
 * Scoped per product on purpose. A SKU is only unique within a product, so
 * resolving one globally could rewrite an unrelated row's history to point at
 * another product's variant.
 */
export async function planVariantUuidRepairs(pool) {
  const { rows: items } = await pool.query(`
    SELECT pii.id, pii.product_id, pii.variant_uuid, pii.line_no,
           p.name AS product_name
    FROM purchase_invoice_items pii
    JOIN products p ON p.id = pii.product_id
    WHERE pii.variant_uuid IS NOT NULL
      AND pii.variant_uuid <> ''
  `);
  if (items.length === 0) return [];

  const { rows: products } = await pool.query(
    `SELECT id, COALESCE(variants, '[]'::jsonb) AS variants FROM products
     WHERE jsonb_array_length(COALESCE(variants, '[]'::jsonb)) > 0`
  );

  const bySku = new Map();
  const byUuid = new Map();
  for (const p of products) {
    const variants = Array.isArray(p.variants) ? p.variants : [];
    for (const v of variants) {
      if (!v || typeof v !== "object") continue;
      const uuid = uuidFor(v);
      if (uuid) byUuid.set(`${p.id}::${uuid}`, v);
      const id = variantIdentity(v);
      if (id && id.kind === "sku") bySku.set(`${p.id}::${id.value}`, v);
    }
  }

  const repairs = [];
  for (const item of items) {
    // Already a genuine uuid — leave it alone.
    if (byUuid.has(`${item.product_id}::${item.variant_uuid}`)) continue;

    const match = bySku.get(`${item.product_id}::${item.variant_uuid.toUpperCase()}`);
    if (!match) continue; // Unknown reference; reported, never guessed at.

    const uuid = uuidFor(match);
    if (!uuid) continue;

    repairs.push({
      itemId: item.id,
      productId: item.product_id,
      productName: item.product_name,
      lineNo: item.line_no,
      from: item.variant_uuid,
      to: uuid,
    });
  }

  return repairs;
}

async function main() {
  await withPool(async (pool) => {
    const { products, missing } = await planBackfill(pool);
    const repairs = await planVariantUuidRepairs(pool);

    console.log(
      `${APPLY ? "apply" : "report"}  variant uuid backfill\n`
    );

    for (const product of products) {
      console.log(`${product.name} (${product.changes.length} variant(s))`);
      for (const c of product.changes) {
        console.log(`  + uuid  ${c.label}  [matched on ${c.matchedOn}]`);
      }
    }
    if (products.length === 0) console.log("  every variant already has a uuid");

    console.log(`\nvariants needing a uuid: ${missing}`);

    if (repairs.length) {
      console.log(`\n${repairs.length} stored variant_uuid value(s) that are SKUs, not uuids:`);
      for (const r of repairs) {
        console.log(
          `  ${r.productName} line ${r.lineNo}: ${r.from}  ->  ${r.to}`
        );
      }
    } else {
      console.log("stored variant_uuid values: all genuine uuids (or none)");
    }

    if (!APPLY) {
      console.log("\nnothing written — re-run with --apply to make these changes");
      return;
    }

    if (products.length === 0 && repairs.length === 0) {
      console.log("\nnothing to do");
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const product of products) {
        await client.query(
          `UPDATE products SET variants = $1::jsonb WHERE id = $2`,
          [JSON.stringify(product.next), product.id]
        );
      }

      for (const r of repairs) {
        await client.query(
          `UPDATE purchase_invoice_items SET variant_uuid = $1 WHERE id = $2`,
          [r.to, r.itemId]
        );
      }

      await client.query("COMMIT");
      console.log(
        `\napplied  ${products.length} product(s), ${missing} uuid(s), ${repairs.length} repair(s)`
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}

// Only run when invoked directly, so the planners stay importable by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`backfill-variant-uuids failed: ${error.message}`);
    process.exit(1);
  });
}