import pool from "../db.js";
import { notifyBackInStock } from "../notifications/backInStock.js";
import { round2, toPaise } from "../giftCardApplicability.js";

// ─────────────────────────────────────────────────────────────────────────────
// Purchase invoices
//
// Three operations, and the invariant they share: stock is never changed without
// a stock_ledger row, and money is never taken from the client. Every figure is
// recomputed here from quantities and unit costs, so a crafted request body
// cannot invent a cheaper invoice or a larger receipt.
//
// Locking, on every mutating path:
//   the invoice  FOR UPDATE  so two receipts cannot interleave on its counters
//   each product FOR UPDATE  in ascending id order, so two receipts touching
//                        the same two products cannot deadlock against each other
// Without the product lock, two concurrent receipts read the same `stock` and
// one update is lost. The ascending order is what prevents the deadlock: it
// makes every transaction take the same locks in the same sequence.
// ─────────────────────────────────────────────────────────────────────────────

// NUMERIC columns arrive from pg as strings. Coerced on read, the same way
// lib/models/wallet.js round2()s its money fields, so a route can add up an
// invoice without knowing how postgres types a column.
const MONEY = Object.freeze([
  "subtotal", "discount_total", "tax_total", "shipping_total", "total_amount",
  "unit_cost", "discount_amount", "tax_amount", "line_total",
  "amount", "balance_after", "unitPrice",
  "total_accepted", "total_damaged", "total_missing",
  "quantity_accepted", "quantity_damaged", "quantity_missing",
  "quantity_ordered", "quantity_received", "quantity_damaged", "quantity_rejected",
  "previous_stock", "new_stock", "stock", "quantity",
  "discount_percent", "tax_percent", "selling_price",
]);

/** Copies a row, turning every numeric field into a number. */
function numeric(row) {
  if (!row) return row;
  const out = { ...row };
  for (const key of MONEY) {
    if (out[key] !== null && out[key] !== undefined) out[key] = round2(out[key]);
  }
  return out;
}

export const INVOICE_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  AWAITING_STOCK: "AWAITING_STOCK",
  PARTIALLY_RECEIVED: "PARTIALLY_RECEIVED",
  RECEIVED: "RECEIVED",
  CANCELLED: "CANCELLED",
});

export const PAYMENT_STATUS = Object.freeze({
  UNPAID: "UNPAID",
  PARTIALLY_PAID: "PARTIALLY_PAID",
  PAID: "PAID",
  OVERDUE: "OVERDUE",
});

export const PAYMENT_METHODS = Object.freeze([
  "CASH", "BANK", "UPI", "CARD", "CHEQUE", "CREDIT_NOTE",
]);

/** A caller-caused condition, so routes can map it to an honest status. */
export class PurchaseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REASON = Object.freeze({
  NOT_FOUND: "NOT_FOUND",
  SUPPLIER_INACTIVE: "SUPPLIER_INACTIVE",
  DUPLICATE_INVOICE_NUMBER: "DUPLICATE_INVOICE_NUMBER",
  EMPTY: "EMPTY",
  BAD_QUANTITY: "BAD_QUANTITY",
  BAD_COST: "BAD_COST",
  NOT_A_DRAFT: "NOT_A_DRAFT",
  CANCELLED: "CANCELLED",
  OVER_RECEIPT: "OVER_RECEIPT",
  NOTHING_RECEIVED: "NOTHING_RECEIVED",
  OVER_PAYMENT: "OVER_PAYMENT",
  BAD_PAYMENT_METHOD: "BAD_PAYMENT_METHOD",
  UNKNOWN_ITEM: "UNKNOWN_ITEM",
  DUPLICATE_PRODUCT: "DUPLICATE_PRODUCT",
  NEEDS_PRODUCT: "NEEDS_PRODUCT",
  NO_NUMBER: "NO_NUMBER",
  NO_REASON: "NO_REASON",
  ALREADY_RECEIVED: "ALREADY_RECEIVED",
  ALREADY_PAID: "ALREADY_PAID",
});

// ── Totals ──────────────────────────────────────────────────────────────────

/**
 * Line and header money, recomputed from scratch.
 *
 * discount_percent and tax_percent are applied to the gross line, and the
 * discount is subtracted before tax, which is the usual retail order. Kept pure
 * and exported so the same arithmetic can be unit tested without a database.
 */
export function computeLineTotals({
  quantityOrdered, unitCost, discountPercent = 0, taxPercent = 0,
}) {
  const qty = Number(quantityOrdered) || 0;
  const cost = Number(unitCost) || 0;
  const dpct = Number(discountPercent) || 0;
  const tpct = Number(taxPercent) || 0;

  const gross = round2(cost * qty);
  const discountAmount = round2((gross * dpct) / 100);
  const taxable = round2(gross - discountAmount);
  const taxAmount = round2((taxable * tpct) / 100);
  return {
    gross,
    discountAmount,
    taxAmount,
    // The header sums line totals, so the invoice total can never disagree
    // with the sum of its own lines.
    lineTotal: round2(taxable + taxAmount),
  };
}

export function computeInvoiceTotals(items, { discountTotal = 0, shippingTotal = 0 } = {}) {
  const subtotal = round2(items.reduce((sum, i) => sum + i.gross, 0));
  const taxTotal = round2(items.reduce((sum, i) => sum + i.taxAmount, 0));
  const discount = round2(
    items.reduce((sum, i) => sum + i.discountAmount, 0) + (Number(discountTotal) || 0)
  );
  const total = round2(
    subtotal - discount + taxTotal + (Number(shippingTotal) || 0)
  );
  return { subtotal, discountTotal: discount, taxTotal, totalAmount: total };
}

/** Rolls an invoice's status up from its lines' receipt progress. */
export function deriveStatus(rows) {
  if (!rows.length) return INVOICE_STATUS.DRAFT;
  const outstanding = rows.some(
    (r) =>
      toPaise(r.quantity_received) + toPaise(r.quantity_damaged) + toPaise(r.quantity_rejected) <
      toPaise(r.quantity_ordered)
  );
  const anyReceived = rows.some((r) => toPaise(r.quantity_received) > 0);
  if (!outstanding && anyReceived) return INVOICE_STATUS.RECEIVED;
  if (anyReceived) return INVOICE_STATUS.PARTIALLY_RECEIVED;
  return INVOICE_STATUS.AWAITING_STOCK;
}

function validateItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new PurchaseError(REASON.EMPTY, "A purchase invoice needs at least one product.");
  }
  const seen = new Set();
  return raw.map((item, index) => {
    const productId = Number(item.productId);
    if (!productId) {
      throw new PurchaseError(
        REASON.NEEDS_PRODUCT,
        raw.productUuid
          ? `Line ${index + 1}: no product matches that selection.`
          : `Line ${index + 1} does not say which product it is.`
      );
    }
    // One supplier invoice may carry many variants of the SAME product (one
    // line per variant), so uniqueness is product+variant -- not product alone.
    // Two genuinely identical lines are still rejected, because merging them
    // would silently change what was invoiced.
    const variantKey = item.variantUuid ? String(item.variantUuid) : "";
    const lineKey = `${productId}::${variantKey}`;

    if (seen.has(lineKey)) {
      throw new PurchaseError(
        REASON.DUPLICATE_PRODUCT,
        variantKey
          ? `The same product and variant appear twice (line ${index + 1}). Combine them into one line.`
          : `Product ${productId} appears twice without a variant (line ${index + 1}). Combine the lines instead.`
      );
    }
    seen.add(lineKey);

    const qty = Number(item.quantityOrdered);
    if (!(qty > 0)) {
      throw new PurchaseError(REASON.BAD_QUANTITY, `Line ${index + 1} needs a quantity above zero.`);
    }
    const cost = Number(item.unitCost);
    if (!(cost >= 0)) {
      throw new PurchaseError(REASON.BAD_COST, `Line ${index + 1} needs a unit cost of zero or more.`);
    }
    const dpct = Number(item.discountPercent ?? 0);
    const tpct = Number(item.taxPercent ?? 0);
    if (dpct < 0 || dpct > 100) {
      throw new PurchaseError(REASON.BAD_COST, `Line ${index + 1} discount must be between 0 and 100.`);
    }
    if (tpct < 0 || tpct > 100) {
      throw new PurchaseError(REASON.BAD_COST, `Line ${index + 1} tax must be between 0 and 100.`);
    }
    // The retail price this purchase sets. Optional, because a purchase may be
    // recorded without repricing -- but when given it must be a real number.
    const sellingPrice = item.sellingPrice === undefined || item.sellingPrice === null || item.sellingPrice === ""
      ? null
      : Number(item.sellingPrice);
    if (sellingPrice !== null && (!Number.isFinite(sellingPrice) || sellingPrice < 0)) {
      throw new PurchaseError(
        REASON.BAD_COST, `Line ${index + 1} selling price cannot be negative.`
      );
    }
    return {
      lineNo: index + 1,
      productId,
      variantUuid: item.variantUuid ? String(item.variantUuid) : null,
      sku: item.sku ? String(item.sku) : "",
      name: item.name ? String(item.name) : "",
      barcode: item.barcode ? String(item.barcode) : null,
      batchNumber: item.batchNumber ? String(item.batchNumber).trim() : null,
      expiryDate: item.expiryDate || null,
      quantityOrdered: qty,
      unitCost: cost,
      sellingPrice,
      discountPercent: dpct,
      taxPercent: tpct,
      ...computeLineTotals({ quantityOrdered: qty, unitCost: cost, discountPercent: dpct, taxPercent: tpct }),
    };
  });
}

/** Next number for an entity, from invoice_sequences, under a row lock. */
async function nextNumber(client, entity) {
  const seq = await client.query(
    `SELECT id, prefix, format, padding, next_value
       FROM invoice_sequences
      WHERE entity = $1 AND series = 'DEFAULT' AND financial_year IS NULL
      FOR UPDATE`,
    [entity]
  );
  const row = seq.rows[0];
  if (!row) throw new PurchaseError(REASON.NO_NUMBER, `No numbering series configured for ${entity}.`);
  await client.query(`UPDATE invoice_sequences SET next_value = next_value + 1 WHERE id = $1`, [row.id]);
  // prefix carries the label and format only places the value. 021 seeded both
  // as "PI-", which rendered PI-PI-000001; migration 022 repairs that.
  const n = String(row.next_value).padStart(row.padding, "0");
  return row.format.replace("%s", `${row.prefix}${n}`);
}

/**
 * Maps a service reason onto an HTTP status, so routes stay declarative.
 *
 * The split is deliberate:
 *   400  the request itself is wrong -- a nonsensical quantity, a missing field
 *   404  the thing named does not exist
 *   409  it already exists (a duplicate supplier invoice number)
 *   422  the request is well formed but conflicts with current state
 */
export function statusForError(error) {
  if (!(error instanceof PurchaseError)) return 500;
  switch (error.code) {
    case REASON.NOT_FOUND:
    case REASON.UNKNOWN_ITEM:
      return 404;
    case REASON.DUPLICATE_INVOICE_NUMBER:
    case REASON.DUPLICATE_PRODUCT:
      return 409;
    // Conflicts with state.
    case REASON.SUPPLIER_INACTIVE:
    case REASON.NOT_A_DRAFT:
    case REASON.CANCELLED:
    case REASON.OVER_RECEIPT:
    case REASON.OVER_PAYMENT:
    case REASON.NOTHING_RECEIVED:
    case REASON.ALREADY_RECEIVED:
    case REASON.ALREADY_PAID:
      return 422;
    // Malformed input: BAD_QUANTITY, BAD_COST, BAD_PAYMENT_METHOD, NO_NUMBER,
    // NO_REASON, NEEDS_PRODUCT, EMPTY all fall through to 400.
    default:
      return 400;
  }
}

/** Resolves a public uuid (or a bare numeric id) to the internal bigint key. */
async function resolveInvoiceId(db, ref) {
  if (ref === undefined || ref === null || ref === "") return null;
  if (/^\d+$/.test(String(ref))) {
    const found = await db.query("SELECT id FROM purchase_invoices WHERE id = $1", [Number(ref)]);
    return found.rows[0]?.id ?? null;
  }
  if (!UUID_RE.test(String(ref))) return null;
  const found = await db.query("SELECT id FROM purchase_invoices WHERE uuid = $1", [ref]);
  return found.rows[0]?.id ?? null;
}

export const PurchaseInvoice = {
  /**
   * Invoice list for the admin table. Filters are optional and combine, and the
   * outstanding figure is a correlated subquery rather than a stored column so
   * it can never drift from the payments that produced it.
   */
  async list({ supplierId = "", status = "", paymentStatus = "", search = "",
               page = 1, limit = 20 } = {}) {
    const where = [];
    const params = [];
    if (supplierId) { params.push(supplierId); where.push(`i.supplier_id = $${params.length}`); }
    if (status) { params.push(status); where.push(`i.status = $${params.length}`); }
    if (paymentStatus) { params.push(paymentStatus); where.push(`i.payment_status = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(i.invoice_number ILIKE $${params.length}
                   OR i.supplier_invoice_number ILIKE $${params.length}
                   OR s.name ILIKE $${params.length})`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const FROM = `FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id ${clause}`;

    const count = await pool.query(
      `SELECT count(*)::int AS total ${FROM}`, params
    );
    params.push(limit, (page - 1) * limit);
    const rows = await pool.query(
      `SELECT i.*, s.name AS supplier_name,
              (SELECT COALESCE(SUM(p.amount),0) FROM purchase_invoice_payments p
                WHERE p.purchase_invoice_id = i.id) AS paid_amount,
              (SELECT count(*)::int FROM purchase_invoice_items it
                WHERE it.purchase_invoice_id = i.id) AS item_count
         ${FROM}
        ORDER BY i.invoice_date DESC, i.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = count.rows[0].total;
    return {
      rows: rows.rows.map((r) => {
        const row = numeric(r);
        row.outstanding = round2(Number(r.total_amount) - Number(r.paid_amount));
        return row;
      }),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  },

  /**
   * Creates a DRAFT invoice with its lines. Stock is untouched: nothing has
   * physically arrived yet, and a draft is editable by definition.
   */
  /**
   * Resolves public product uuids to the internal ids the ledger stores.
   *
   * The catalogue deliberately never sends integer ids to a client, so a line
   * built from the admin UI can only name a product by uuid. Resolution happens
   * here, inside the caller's transaction, so the uuid cannot be swapped between
   * the check and the insert.
   */
  async resolveProductRefs(items, client) {
    const uuids = items.map((i) => i.productUuid).filter(Boolean);
    if (!uuids.length) return items;
    const found = await client.query(
      "SELECT id, uuid FROM products WHERE uuid = ANY($1::uuid[])",
      [uuids]
    );
    const byUuid = new Map(found.rows.map((r) => [r.uuid, r.id]));
    return items.map((item) =>
      item.productUuid ? { ...item, productId: byUuid.get(item.productUuid) ?? null } : item
    );
  },

  async create(
    { supplierId, supplierInvoiceNumber, invoiceDate, dueDate = null, items: rawItems,
      shippingTotal = 0, notes = null, warehouseId = null, createdBy = null },
    client = null
  ) {
    const db = client || pool;
    const owned = client ? null : await db.connect();
    const runner = owned || db;
    try {
      if (owned) await runner.query("BEGIN");

      const sup = Number(supplierId);
      if (!sup) throw new PurchaseError(REASON.NOT_FOUND, "A purchase invoice needs a supplier.");
      const supplier = await runner.query(
        "SELECT id, name, is_active, payment_terms_days FROM suppliers WHERE id = $1", [sup]
      );
      if (!supplier.rows[0]) throw new PurchaseError(REASON.NOT_FOUND, "No such supplier.");
      if (!supplier.rows[0].is_active) {
        throw new PurchaseError(REASON.SUPPLIER_INACTIVE, "That supplier is not active.");
      }

      const supNo = String(supplierInvoiceNumber || "").trim();
      if (!supNo) {
        throw new PurchaseError(REASON.NO_NUMBER, "The supplier's own invoice number is required.");
      }
      // The duplicate guard, surfaced as a message rather than left to surface
      // as a bare unique-constraint error.
      const dupe = await runner.query(
        "SELECT 1 FROM purchase_invoices WHERE supplier_id = $1 AND supplier_invoice_number = $2",
        [sup, supNo]
      );
      if (dupe.rows.length) {
        throw new PurchaseError(
          REASON.DUPLICATE_INVOICE_NUMBER,
          `Supplier ${sup} already has an invoice numbered ${supNo}.`
        );
      }

      // A uuid that matches no product resolves to null and is then reported
      // against the line that named it, rather than as a bare "no such product".
      const lines = validateItems(await this.resolveProductRefs(rawItems, runner));

      // Default to the central warehouse; a transfer invoice names its own.
      let wh = warehouseId
        ? Number(warehouseId)
        : (await runner.query("SELECT id FROM warehouses WHERE kind = 'CENTRAL' AND is_active LIMIT 1")).rows[0]?.id;
      if (!wh) throw new PurchaseError(REASON.NOT_FOUND, "No central warehouse is configured.");

      const products = await runner.query(
        "SELECT id, name, sku, price FROM products WHERE id = ANY($1::bigint[])",
        [lines.map((l) => l.productId)]
      );
      const byId = new Map(products.rows.map((p) => [Number(p.id), p]));
      const unknown = lines.find((l) => !byId.has(l.productId));
      if (unknown) {
        throw new PurchaseError(REASON.UNKNOWN_ITEM, `No product with id ${unknown.productId}.`);
      }

      const totals = computeInvoiceTotals(lines, { shippingTotal });
      const invoiceNumber = await nextNumber(runner, "PURCHASE_INVOICE");

      const invoice = await runner.query(
        `INSERT INTO purchase_invoices
           (invoice_number, supplier_invoice_number, supplier_id, invoice_date, due_date,
            status, payment_status, warehouse_id, subtotal, discount_total, tax_total,
            shipping_total, total_amount, notes, created_by)
         VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [invoiceNumber, supNo, sup, invoiceDate || null, dueDate,
         INVOICE_STATUS.AWAITING_STOCK, PAYMENT_STATUS.UNPAID, wh,
         totals.subtotal, totals.discountTotal, totals.taxTotal,
         round2(shippingTotal), totals.totalAmount, notes, createdBy]
      );

      for (const line of lines) {
        const product = byId.get(line.productId);
        await runner.query(
          `INSERT INTO purchase_invoice_items
             (purchase_invoice_id, line_no, product_id, variant_uuid, sku, name, barcode,
              quantity_ordered, unit_cost, selling_price, discount_percent, discount_amount,
              tax_percent, tax_amount, line_total, batch_number, expiry_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [invoice.rows[0].id, line.lineNo, line.productId, line.variantUuid,
           line.sku || product.sku || "", line.name || product.name || "",
           line.barcode, line.quantityOrdered, line.unitCost, line.sellingPrice,
           line.discountPercent, line.discountAmount,
           line.taxPercent, line.taxAmount, line.lineTotal,
           line.batchNumber, line.expiryDate]
        );
      }

      if (owned) await runner.query("COMMIT");
      return this.findById(invoice.rows[0].id, { client: runner });
    } catch (error) {
      if (owned) await runner.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      if (owned) owned.release();
    }
  },

  async findById(id, { client = null } = {}) {
    const runner = client || pool;
    const key = await resolveInvoiceId(runner, id);
    if (!key) return null;
    const invoice = await runner.query(
      "SELECT * FROM purchase_invoices WHERE id = $1", [key]
    );
    if (!invoice.rows[0]) return null;
    const items = await runner.query(
      "SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = $1 ORDER BY line_no", [key]
    );
    const payments = await runner.query(
      "SELECT * FROM purchase_invoice_payments WHERE purchase_invoice_id = $1 ORDER BY paid_at", [key]
    );
    return {
      ...numeric(invoice.rows[0]),
      items: items.rows.map(numeric),
      payments: payments.rows.map(numeric),
      outstanding: round2(
        Number(invoice.rows[0].total_amount) -
          payments.rows.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
      ),
    };
  },

  /**
   * Records goods arriving against an invoice, and moves central stock.
   *
   * `lines` is [{ purchaseInvoiceItemId, accepted, damaged, missing, reason }].
   * Accepted quantity is the only part that becomes sellable stock. Damaged and
   * missing are recorded against the invoice so the supplier can be queried, and
   * deliberately do NOT reach products.stock.
   *
   * All of it — the receipt, the stock update, the ledger rows and the invoice
   * roll-up — is one transaction. A ledger row can never exist without its
   * stock change, and a stock change can never exist without its ledger row.
   */
  async receiveStock(
    { invoiceId, lines, notes = null, performedBy = null },
    client = null
  ) {
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new PurchaseError(REASON.NOTHING_RECEIVED, "Nothing was received.");
    }
    const db = client || pool;
    const owned = client ? null : await db.connect();
    const runner = owned || db;
    try {
      if (owned) await runner.query("BEGIN");

      const key = await resolveInvoiceId(runner, invoiceId);
      if (!key) throw new PurchaseError(REASON.NOT_FOUND, "No such purchase invoice.");
      invoiceId = key;

      const locked = await runner.query(
        "SELECT * FROM purchase_invoices WHERE id = $1 FOR UPDATE", [invoiceId]
      );
      const invoice = locked.rows[0];
      if (!invoice) throw new PurchaseError(REASON.NOT_FOUND, "No such purchase invoice.");
      if (invoice.status === INVOICE_STATUS.CANCELLED) {
        throw new PurchaseError(REASON.CANCELLED, "That invoice is cancelled.");
      }

      const ids = lines.map((l) => Number(l.purchaseInvoiceItemId));
      const itemRows = await runner.query(
        "SELECT * FROM purchase_invoice_items WHERE purchase_invoice_id = $1 AND id = ANY($2::bigint[])",
        [invoiceId, ids]
      );
      const byItem = new Map(itemRows.rows.map((r) => [Number(r.id), r]));
      const missing = ids.filter((i) => !byItem.has(i));
      if (missing.length) {
        throw new PurchaseError(REASON.UNKNOWN_ITEM, `Line ${missing[0]} is not on this invoice.`);
      }

      // Validate every line BEFORE writing anything, so a bad line cannot leave
      // a half-applied receipt.
      const plan = lines.map((l) => {
        const item = byItem.get(Number(l.purchaseInvoiceItemId));
        const accepted = Number(l.accepted ?? 0);
        const damaged = Number(l.damaged ?? 0);
        const missingQty = Number(l.missing ?? 0);
        for (const [label, v] of [["accepted", accepted], ["damaged", damaged], ["missing", missingQty]]) {
          if (!(v >= 0)) {
            throw new PurchaseError(REASON.BAD_QUANTITY, `${label} quantity cannot be negative.`);
          }
        }
        const already =
          Number(item.quantity_received) + Number(item.quantity_damaged) + Number(item.quantity_rejected);
        const adding = accepted + damaged + missingQty;
        if (adding <= 0) {
          throw new PurchaseError(REASON.NOTHING_RECEIVED, "A receipt line must carry a quantity.");
        }
        // The database has the same CHECK; this turns a violation into a message
        // instead of a constraint error surfacing to the caller.
        if (round2(already + adding) > round2(Number(item.quantity_ordered))) {
          throw new PurchaseError(
            REASON.OVER_RECEIPT,
            `Line ${item.line_no}: ${already + adding} of ${Number(item.quantity_ordered)} ordered.`
          );
        }
        return { item, accepted, damaged, missingQty, reason: l.reason || null };
      });

      // Lock products in ascending id order, once for the whole receipt.
      const productIds = [...new Set(plan.map((p) => Number(p.item.product_id)))].sort((a, b) => a - b);
      const products = await runner.query(
        "SELECT id, stock FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
        [productIds]
      );
      const stockById = new Map(products.rows.map((p) => [Number(p.id), Number(p.stock) || 0]));

      const receiptNumber = await nextNumber(runner, "STOCK_RECEIPT");
      const receipt = await runner.query(
        `INSERT INTO stock_receipts
           (receipt_number, purchase_invoice_id, warehouse_id, status, notes,
            total_accepted, total_damaged, total_missing, created_by)
         VALUES ($1,$2,$3,'POSTED',$4,$5,$6,$7,$8) RETURNING *`,
        [receiptNumber, invoiceId, invoice.warehouse_id, notes,
         plan.reduce((s, p) => s + p.accepted, 0),
         plan.reduce((s, p) => s + p.damaged, 0),
         plan.reduce((s, p) => s + p.missingQty, 0), performedBy]
      );

      for (const step of plan) {
        const { item, accepted, damaged, missingQty } = step;
        await runner.query(
          `INSERT INTO stock_receipt_items
             (stock_receipt_id, purchase_invoice_item_id, quantity_accepted,
              quantity_damaged, quantity_missing, unit_cost, damage_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [receipt.rows[0].id, item.id, accepted, damaged, missingQty,
           Number(item.unit_cost), step.reason]
        );

        await runner.query(
          `UPDATE purchase_invoice_items
              SET quantity_received = quantity_received + $2,
                  quantity_damaged  = quantity_damaged  + $3,
                  quantity_rejected = quantity_rejected + $4,
                  updated_at = now()
            WHERE id = $1`,
          [item.id, accepted, damaged, missingQty]
        );

        if (accepted > 0) {
          const previous = stockById.get(Number(item.product_id)) ?? 0;
          const next = round2(previous + accepted);
          // Stock and price move together: receiving goods is the only event
          // that sets either. selling_price is null on an older invoice, which
          // means "this purchase did not reprice", so the current price stands.
          const sellingPrice = item.selling_price;
          await runner.query(
            `UPDATE products
                SET stock = $2,
                    price = COALESCE($3, price),
                    updated_at = now()
              WHERE id = $1`,
            [item.product_id, next, sellingPrice === null ? null : round2(sellingPrice)]
          );
          // The ledger row and the stock write are in the same transaction, so
          // one can never exist without the other.
          await runner.query(
            `INSERT INTO stock_ledger
               (warehouse_id, product_id, variant_uuid, quantity, unit_cost,
                previous_stock, new_stock, transaction_type, reference_type,
                reference_id, note, performed_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'PURCHASE_RECEIPT','STOCK_RECEIPT',$8,$9,$10)`,
            [invoice.warehouse_id, item.product_id, item.variant_uuid, accepted,
             Number(item.unit_cost), previous, next, receipt.rows[0].id,
             notes, performedBy]
          );
          // Batch per received variant line (§12). A batch is the unit of
          // cost/expiry/warehouse, so it must be created per accepted line.
          // batch_number falls back to the receipt number when the user did
          // not key one on the invoice line.
          await runner.query(
            `INSERT INTO product_batches
               (batch_number, product_id, variant_uuid, supplier_id,
                purchase_invoice_id, stock_receipt_id, warehouse_id,
                received_at, expiry_date, quantity_received, quantity_remaining,
                cost_price, status, notes, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8,$9,$9,$10,'AVAILABLE',$11,$12)`,
            [item.batch_number || receipt.rows[0].receipt_number,
             item.product_id, item.variant_uuid, invoice.supplier_id,
             invoiceId, receipt.rows[0].id, invoice.warehouse_id,
             item.expiry_date || null, accepted, Number(item.unit_cost),
             notes, performedBy]
          );
          stockById.set(Number(item.product_id), next);
        }
      }

      const after = await runner.query(
        "SELECT quantity_ordered, quantity_received, quantity_damaged, quantity_rejected FROM purchase_invoice_items WHERE purchase_invoice_id = $1",
        [invoiceId]
      );
      const status = deriveStatus(after.rows);
      await runner.query(
        "UPDATE purchase_invoices SET status = $2, updated_at = now() WHERE id = $1",
        [invoiceId, status]
      );

      if (owned) await runner.query("COMMIT");

      // After the commit, deliberately. The receiving module only declares that
      // stock moved; it does not know that notifications exist or how they work.
      // notifyBackInStock decides for itself whether anyone is waiting and never
      // throws, so a delivery problem cannot undo the receipt.
      for (const productId of new Set(plan.map((step) => Number(step.item.product_id)))) {
        const uuid = await runner
          .query("SELECT uuid FROM products WHERE id = $1", [productId])
          .then((r) => r.rows[0]?.uuid)
          .catch(() => null);
        if (uuid) await notifyBackInStock({ productUuid: uuid });
      }

      return { receipt: numeric(receipt.rows[0]), status,
               invoice: await this.findById(invoiceId, { client: runner }) };
    } catch (error) {
      if (owned) await runner.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      if (owned) owned.release();
    }
  },

  /**
   * Cancels an invoice.
   *
   * Refused once any stock has arrived: cancelling would leave that stock in the
   * warehouse with no document behind it, which is the one thing an audit trail
   * cannot survive. Reverse it with a purchase return instead, which keeps the
   * goods and the paperwork connected.
   */
  async cancel({ invoiceId, reason = null, cancelledBy = null }, client = null) {
    if (!String(reason || "").trim()) {
      throw new PurchaseError(REASON.NO_REASON, "A cancellation needs a reason.");
    }
    const db = client || pool;
    const owned = client ? null : await db.connect();
    const runner = owned || db;
    try {
      if (owned) await runner.query("BEGIN");

      const key = await resolveInvoiceId(runner, invoiceId);
      if (!key) throw new PurchaseError(REASON.NOT_FOUND, "No such purchase invoice.");
      invoiceId = key;

      const locked = await runner.query(
        "SELECT * FROM purchase_invoices WHERE id = $1 FOR UPDATE", [invoiceId]
      );
      const invoice = locked.rows[0];
      if (!invoice) throw new PurchaseError(REASON.NOT_FOUND, "No such purchase invoice.");
      if (invoice.status === INVOICE_STATUS.CANCELLED) {
        throw new PurchaseError(REASON.CANCELLED, "That invoice is already cancelled.");
      }

      const received = await runner.query(
        `SELECT COALESCE(SUM(quantity_received),0) AS qty
           FROM purchase_invoice_items WHERE purchase_invoice_id = $1`,
        [invoiceId]
      );
      if (Number(received.rows[0].qty) > 0) {
        throw new PurchaseError(
          REASON.ALREADY_RECEIVED,
          "Stock has already been received against this invoice. Use a purchase return instead."
        );
      }

      const paid = await runner.query(
        `SELECT COALESCE(SUM(amount),0) AS amount FROM purchase_invoice_payments
          WHERE purchase_invoice_id = $1`,
        [invoiceId]
      );
      if (Number(paid.rows[0].amount) > 0) {
        throw new PurchaseError(
          REASON.ALREADY_PAID,
          "This invoice has payments recorded. Reverse them before cancelling."
        );
      }

      // cancelled_at and status are set together, which is what
      // purchase_invoices_cancel_check enforces.
      const updated = await runner.query(
        `UPDATE purchase_invoices
            SET status = $2, cancelled_at = now(), cancel_reason = $3, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [invoiceId, INVOICE_STATUS.CANCELLED, String(reason).trim()]
      );

      if (owned) await runner.query("COMMIT");
      return this.findById(invoiceId, { client: runner });
    } catch (error) {
      if (owned) await runner.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      if (owned) owned.release();
    }
  },

  /**
   * Records a payment against an invoice, in part or in full.
   *
   * A payment never touches stock, and never touches the invoice total. It only
   * moves payment_status and leaves a running balance_after on the ledger, so
   * the payment history audits itself.
   */
  async recordPayment(
    { invoiceId, amount, method = "BANK", reference = null, notes = null, paidAt = null, createdBy = null },
    client = null
  ) {
    const value = round2(amount);
    if (!(value > 0)) {
      throw new PurchaseError(REASON.BAD_QUANTITY, "A payment must be more than zero.");
    }
    if (!PAYMENT_METHODS.includes(method)) {
      throw new PurchaseError(REASON.BAD_PAYMENT_METHOD, `Unknown payment method: ${method}.`);
    }

    const db = client || pool;
    const owned = client ? null : await db.connect();
    const runner = owned || db;
    try {
      if (owned) await runner.query("BEGIN");

      const key = await resolveInvoiceId(runner, invoiceId);
      if (!key) throw new PurchaseError(REASON.NOT_FOUND, "No such purchase invoice.");
      invoiceId = key;

      const locked = await runner.query(
        "SELECT * FROM purchase_invoices WHERE id = $1 FOR UPDATE", [invoiceId]
      );
      const invoice = locked.rows[0];
      if (!invoice) throw new PurchaseError(REASON.NOT_FOUND, "No such purchase invoice.");
      if (invoice.status === INVOICE_STATUS.CANCELLED) {
        throw new PurchaseError(REASON.CANCELLED, "That invoice is cancelled.");
      }

      const paid = await runner.query(
        "SELECT COALESCE(SUM(amount),0) AS paid FROM purchase_invoice_payments WHERE purchase_invoice_id = $1",
        [invoiceId]
      );
      const already = round2(Number(paid.rows[0].paid) || 0);
      const total = round2(Number(invoice.total_amount));
      const outstanding = round2(total - already);

      // Overpaying would make the invoice look settled and leave a credit
      // nobody can see, so it is refused rather than quietly absorbed.
      if (value > outstanding) {
        throw new PurchaseError(
          REASON.OVER_PAYMENT,
          `Only ${outstanding} is outstanding on this invoice.`
        );
      }
      if (outstanding <= 0) {
        throw new PurchaseError(REASON.OVER_PAYMENT, "That invoice is already fully paid.");
      }

      const payment = await runner.query(
        `INSERT INTO purchase_invoice_payments
           (purchase_invoice_id, amount, paid_at, method, reference, notes, balance_after, created_by)
         VALUES ($1,$2,COALESCE($3::timestamptz, now()),$4,$5,$6,$7,$8) RETURNING *`,
        [invoiceId, value, paidAt, method, reference, notes, round2(outstanding - value), createdBy]
      );

      const remaining = round2(outstanding - value);
      await runner.query(
        "UPDATE purchase_invoices SET payment_status = $2, updated_at = now() WHERE id = $1",
        [invoiceId, remaining === 0 ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PARTIALLY_PAID]
      );

      if (owned) await runner.query("COMMIT");
      return { payment: numeric(payment.rows[0]), outstanding: remaining, invoice: await this.findById(invoiceId, { client: runner }) };
    } catch (error) {
      if (owned) await runner.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      if (owned) owned.release();
    }
  },
};
