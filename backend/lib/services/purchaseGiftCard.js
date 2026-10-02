// Selling a gift card: one payment, `quantity` one-time codes, and a delivery row
// per code for the worker to pick up.
//
// This is the mirror image of lib/services/claimGiftCard.js. The claim turns a
// string a stranger typed into wallet money; this turns a shopper's payment into
// strings the stranger will type. The two are the same transaction seen from
// opposite ends, and the rules below exist because a code is the only copy of
// something the customer owns:
//
//   * NO CODE IS EVER MINTED BEFORE THE MONEY IS IN. The purchase row is written
//     first as PENDING_PAYMENT, the gateway is called with no transaction open,
//     and the codes are only issued once confirmation has come back PAID and has
//     been reconciled against the amount we asked for. A declined card leaves a
//     FAILED purchase row and nothing else.
//   * THE CODES AND THEIR PURCHASE MOVE TOGETHER. The purchase row's transition
//     to PAID/ISSUED, the `quantity` codes and their delivery rows are ONE
//     transaction. A failure anywhere in that batch rolls the whole thing back, so
//     a code can never exist against a purchase that does not, and a purchase
//     can never read as issued while some of its codes are missing.
//   * THE PLAINTEXT LEAVES EXACTLY ONCE. issueInTx hands the code back to its
//     caller and nowhere else; this module passes it up to the route, which shows
//     it to the buyer and drops it. Nothing here writes one to a log, an error or
//     a database column.
//   * A REFUND VOIDS UNSPENT CODES ONLY. A code that has already been claimed is
//     money sitting in somebody's wallet; see refundPurchase below.
//
// Everything monetary is computed in integer paise with round2/toPaise from
// giftCardApplicability, so a total can never carry a fraction of a paisa into a
// payment intent.
import pool from "../db.js";
import { GiftCardCode } from "../models/giftCardCode.js";
import { generateCode } from "../giftCardCodeGen.js";
import { round2, toPaise } from "../giftCardApplicability.js";
import { sellabilityOf, SELLABILITY_REASON } from "../giftCardSellability.js";
import { createPaymentProvider, registeredProviders } from "../payment/provider.js";

const PURCHASE_TABLE = "gift_card_purchases";
const DELIVERY_TABLE = "gift_card_deliveries";
const TEMPLATE_TABLE = "gift_cards";

// Mirrors the CHECKs on gift_card_purchases exactly, so a status written here is
// a status the column will accept and a reader of this file can check them.
export const PAYMENT_STATUS = Object.freeze({
  PENDING: "PENDING",
  PAID: "PAID",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
});

export const PURCHASE_STATUS = Object.freeze({
  PENDING_PAYMENT: "PENDING_PAYMENT",
  ISSUED: "ISSUED",
  SCHEDULED: "SCHEDULED",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
});

// Mirrors the CHECK on gift_card_deliveries.status. SKIPPED is the honest
// outcome for a code with nowhere to send — see insertDelivery.
export const DELIVERY_STATUS = Object.freeze({
  PENDING: "PENDING",
  SENDING: "SENDING",
  SENT: "SENT",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
});

// One order's bounds, matching the storefront's own limits in
// app/api/store/gift-cards/purchase/route.js. Enforced server-side as well as in
// the form: a client that posts 500 must be refused, not believed.
export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 20;

// The legacy route's ceiling (₹50,000 × 20) reused as a rupee figure, because a
// batch can otherwise multiply past any sane amount and the failure lands on a
// real gateway.
const MAX_ORDER_TOTAL = 1000000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The same shape lib/uuid.js recognises, inlined so this module stays importable
// by plain Node (see loadTemplate).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The stable reasons. These strings are the contract between this service and
// the endpoint that maps them to HTTP statuses, so they are matched on, never
// parsed out of a message. Adding a case here means adding a row to that map.
const PURCHASE_REASON = Object.freeze({
  // The five sell-decision reasons are ASSIGNED from lib/giftCardSellability.js
  // rather than typed out again, because that module now owns the rule and the
  // admin template routes ask it the same question. Two copies of a code is two
  // chances to disagree, and a disagreement here is a card sold for one amount
  // and delivered for another.
  TEMPLATE_NOT_FOUND: SELLABILITY_REASON.NOT_FOUND,
  TEMPLATE_ARCHIVED: SELLABILITY_REASON.ARCHIVED,
  TEMPLATE_NOT_SELLABLE: SELLABILITY_REASON.NOT_SELLABLE,
  TEMPLATE_NOT_ON_SALE: SELLABILITY_REASON.NOT_ON_SALE,
  TEMPLATE_NO_VALUE: SELLABILITY_REASON.NO_VALUE,
  TEMPLATE_VALUE_MISMATCH: SELLABILITY_REASON.VALUE_MISMATCH,
  INVALID_QUANTITY: "INVALID_QUANTITY",
  QUANTITY_LIMIT: "QUANTITY_LIMIT",
  PURCHASE_TOO_LARGE: "PURCHASE_TOO_LARGE",
  RECIPIENT_REQUIRED: "RECIPIENT_REQUIRED",
  RECIPIENT_INVALID: "RECIPIENT_INVALID",
  UNKNOWN_PAYMENT_PROVIDER: "UNKNOWN_PAYMENT_PROVIDER",
  PAYMENT_DECLINED: "PAYMENT_DECLINED",
  PAYMENT_MISMATCH: "PAYMENT_MISMATCH",
  ISSUANCE_FAILED: "ISSUANCE_FAILED",
  REFUND_NOT_FOUND: "REFUND_NOT_FOUND",
  REFUND_ALREADY_DONE: "REFUND_ALREADY_DONE",
  REFUND_NOT_PAID: "REFUND_NOT_PAID",
  REFUND_CODE_CLAIMED: "REFUND_CODE_CLAIMED",
});

// A shopper-facing sentence per reason. None of them is derived from a code, a
// hash or any other input, because none of these paths ever holds one.
const PURCHASE_MESSAGE = Object.freeze({
  TEMPLATE_NOT_FOUND: "We could not find that gift card.",
  TEMPLATE_ARCHIVED: "This gift card is no longer available.",
  TEMPLATE_NOT_SELLABLE: "This gift card is not currently on sale.",
  TEMPLATE_NOT_ON_SALE: "This gift card is not currently on sale.",
  TEMPLATE_NO_VALUE: "This gift card has no value and cannot be bought.",
  TEMPLATE_VALUE_MISMATCH: "This gift card is not set up correctly and cannot be bought.",
  INVALID_QUANTITY: `Choose how many gift cards you want (${MIN_QUANTITY} to ${MAX_QUANTITY}).`,
  QUANTITY_LIMIT: `You can buy up to ${MAX_QUANTITY} gift cards in one order.`,
  PURCHASE_TOO_LARGE: "That is too large a purchase. Please buy fewer gift cards.",
  RECIPIENT_REQUIRED: "Tell us where to send the gift card.",
  RECIPIENT_INVALID: "That recipient email address does not look right.",
  UNKNOWN_PAYMENT_PROVIDER: "That payment method is not available.",
  PAYMENT_DECLINED: "Your payment was declined and no gift card has been issued.",
  PAYMENT_MISMATCH:
    "The payment did not settle for the expected amount, so no gift card has been issued. We are looking into it.",
  ISSUANCE_FAILED:
    "We took your payment but could not issue the gift card. Nothing has been issued and our team is looking into it.",
  REFUND_NOT_FOUND: "We could not find that gift card purchase.",
  REFUND_ALREADY_DONE: "That purchase has already been refunded.",
  REFUND_NOT_PAID: "That purchase was never paid for, so there is nothing to refund.",
  REFUND_CODE_CLAIMED:
    "One of these gift cards has already been added to a wallet, so the refund cannot be made by voiding the card.",
});

/**
 * A refusal with a machine-readable reason.
 *
 * `code` is the whole contract, exactly as ClaimError's is. The endpoint maps it
 * to a status and shows `message`; it must never show a stack or an underlying
 * driver error, because those describe the inside of a money-moving transaction.
 */
export class PurchaseError extends Error {
  constructor(code, message) {
    super(message || PURCHASE_MESSAGE[code] || "This gift card could not be purchased.");
    this.name = "PurchaseError";
    this.code = code;
  }
}

// NUMERIC columns arrive from pg as strings. Money is turned into a Number at
// this edge rather than at every read site, and ids into Number for the same
// reason claimGiftCard does: "12" and 12 must not both be in circulation.
function mapPurchase(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    template_id: Number(row.template_id),
    purchaser_id: row.purchaser_id == null ? null : Number(row.purchaser_id),
    quantity: Number(row.quantity),
    unit_face_value: round2(row.unit_face_value),
    unit_selling_price: row.unit_selling_price == null ? null : round2(row.unit_selling_price),
    total_amount: round2(row.total_amount),
  };
}

// The purchase row as it is stored, without the plaintext codes: the codes are a
// separate thing and the row has never held one.
const PURCHASE_COLUMNS =
  "id, uuid, purchaser_id, template_id, quantity, unit_face_value, unit_selling_price," +
  " total_amount, currency, payment_provider, payment_intent_id, payment_reference," +
  " payment_status, status, recipient_email, recipient_name, gift_message," +
  " created_at, updated_at";

/**
 * Loads a template by public uuid or by internal id.
 *
 * Both are accepted because the storefront holds uuids and the admin panel holds
 * ids, and neither shape can be mistaken for the other — a uuid never parses as a
 * bigint. Anything else resolves to null rather than being cast, so a garbage id
 * is a refusal and not a Postgres type error.
 *
 * The uuid shape is checked here rather than with lib/uuid.js's isValidUuid: that
 * module is a route helper (it also builds Responses) and imports cors
 * extensionlessly, so plain Node — which is what the test suite is — cannot
 * resolve it. The pattern is the same one lib/uuid.js uses.
 */
async function loadTemplate(client, templateRef) {
  const ref = typeof templateRef === "string" ? templateRef.trim() : templateRef;
  if (ref == null || ref === "") return null;
  if (UUID_RE.test(ref)) {
    const result = await client.query(
      `SELECT id, uuid, label, status, is_active, face_value, initial_amount, selling_price,
              currency, validity_days, max_quantity_per_order, starts_at, ends_at
         FROM ${TEMPLATE_TABLE} WHERE uuid = $1::uuid LIMIT 1`,
      [ref]
    );
    return result.rows[0] || null;
  }
  if (!/^\d+$/.test(String(ref))) return null;
  const result = await client.query(
    `SELECT id, uuid, label, status, is_active, face_value, initial_amount, selling_price,
            currency, validity_days, max_quantity_per_order, starts_at, ends_at
       FROM ${TEMPLATE_TABLE} WHERE id = $1::bigint LIMIT 1`,
    [ref]
  );
  return result.rows[0] || null;
}

/**
 * Whether this template may be sold right now, as one decision in one place.
 *
 * The RULE is lib/giftCardSellability.js's sellabilityOf — the same function the
 * admin template routes ask, so the screen that says a template is sellable and
 * the checkout that sells it cannot disagree. This wrapper exists only to turn
 * that function's refusal into the PurchaseError this service's callers already
 * know how to map.
 *
 * Three separate things have to agree, which is why `status` alone is not enough.
 * lib/giftCardSellability.js documents each rule and why it exists; the one worth
 * repeating here is the value agreement. GiftCardCode.issueInTx takes the face
 * value it stamps on the code from the template's `initial_amount`, not from
 * `face_value` — it is the legacy column and that behaviour is already fixed and
 * tested. So the two have to agree, or a buyer is quoted one number and handed a
 * card worth another.
 *
 * The legacy rows this used to have to work around are the reason the rule
 * stopped being an accident: all seven cards gift_cards held carried is_active =
 * true and no face_value at all, so an earlier version of this function would
 * have sold a ₹44 card to anyone who asked, with the sell gate wide open and
 * nothing else looking. Migration 020 retires those rows to ARCHIVED, which is
 * what assertSellable checks first.
 */
function assertSellable(template, now) {
  const check = sellabilityOf(template, now);
  if (!check.sellable) throw new PurchaseError(check.reason);
  return check.faceValuePaise;
}

/**
 * The count of cards, or null if the caller did not send one that is unambiguously
 * a whole number.
 *
 * Refused rather than coerced on purpose. `Math.max(1, parseInt(2.7))` is the kind
 * of tidy-up that turns "buy two" into "buy three" and bills somebody for it.
 */
function parseQuantity(raw) {
  if (typeof raw === "number") return Number.isSafeInteger(raw) ? raw : null;
  // A JSON body may carry the count as a string; only a bare run of digits is
  // accepted, so "2.5", "2e1" and "two" are all refused.
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) return Number(raw.trim());
  return null;
}

function assertQuantity(raw, template) {
  const count = parseQuantity(raw);
  if (count == null) throw new PurchaseError(PURCHASE_REASON.INVALID_QUANTITY);
  if (count < MIN_QUANTITY || count > MAX_QUANTITY) {
    throw new PurchaseError(PURCHASE_REASON.QUANTITY_LIMIT);
  }
  // The template may be stricter than the store's own ceiling (a ₹500 card sold
  // one at a time, say). Strictly tighter, never looser.
  const cap = Number(template.max_quantity_per_order);
  if (Number.isInteger(cap) && cap > 0 && count > cap) {
    throw new PurchaseError(PURCHASE_REASON.QUANTITY_LIMIT);
  }
  return count;
}

function normalizeEmail(raw) {
  const email = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!email) return "";
  if (!EMAIL_RE.test(email)) throw new PurchaseError(PURCHASE_REASON.RECIPIENT_INVALID);
  return email;
}

function normalizeText(raw, max) {
  const value = String(raw == null ? "" : raw).trim();
  return value ? value.slice(0, max) : null;
}

/**
 * Writes the delivery the worker will pick up.
 *
 * PENDING means "send this". SKIPPED means "there was nowhere to send it", and
 * the difference is the whole point: SMS has no provider configured, so a guest
 * with no recipient address gets an honest row that says nothing went out,
 * rather than a PENDING row the worker would pick up and retry forever, and
 * rather than a silent drop that leaves support with no way to answer "did it
 * arrive?".
 *
 * recipient_email is NOT NULL, so a purchase with no address stores an empty
 * string — the destination really was absent, and recording that beats inventing
 * an address to satisfy the column.
 *
 * The partial unique index gift_card_deliveries_one_pending_per_code allows one
 * PENDING row per code. Exactly one delivery is written per freshly issued code,
 * so it cannot collide here; a resend after a failure is a new row on a code
 * whose previous PENDING row has already left the PENDING state.
 */
async function insertDelivery(client, { codeId, purchaseId, recipientEmail, recipientName }) {
  const sendable = Boolean(recipientEmail);
  const result = await client.query(
    `INSERT INTO ${DELIVERY_TABLE}
       (code_id, purchase_id, channel, recipient_email, recipient_name, scheduled_for, status)
     VALUES ($1, $2, 'EMAIL', $3, $4, NULL, $5)
     RETURNING id, uuid, code_id, purchase_id, channel, recipient_email, recipient_name,
               scheduled_for, status, attempt_count, sent_at`,
    [codeId, purchaseId, recipientEmail, recipientName, sendable ? DELIVERY_STATUS.PENDING : DELIVERY_STATUS.SKIPPED]
  );
  return result.rows[0];
}

/**
 * The default issuance loop: `quantity` codes, minted one at a time.
 *
 * A parameter of purchaseGiftCard rather than an inline `for` so a failure can be
 * put in the MIDDLE of a batch and the rollback observed (see the test suite).
 * Nothing in the app passes it, and it has to be a parameter rather than an
 * import the test can swap: with the guards above in place the real loop can only
 * fail on a hash collision or a missing template, so without this seam the
 * all-or-nothing behaviour would be untestable.
 */
async function defaultIssueCodesInTx(client, { templateId, purchaseId, quantity, expiresAt = null }) {
  const issued = [];
  for (let i = 0; i < quantity; i++) {
    issued.push(await GiftCardCode.issueInTx(client, { templateId, purchaseId, code: generateCode(), expiresAt }));
  }
  return issued;
}

/**
 * Asks the gateway to take the money, then whether it did.
 *
 * Reconciliation is the reason this is more than `if (status === 'PAID')`. The
 * sandbox echoes `amount`, `currency` and `metadata` back on confirm, which is
 * what lets the caller check that the gateway settled what was actually asked for
 * rather than trusting a status string. An amount that came back different is
 * treated exactly like a decline: no code is issued.
 */
async function takePayment(gateway, { amount, currency, template, purchaseId, quantity }) {
  const intent = await gateway.createIntent({
    amount,
    currency,
    reference: purchaseId,
    metadata: { purchaseId, templateId: Number(template.id), quantity },
  });
  const confirmation = await gateway.confirm(intent?.intentId);

  if (String(confirmation?.status || "") !== PAYMENT_STATUS.PAID) {
    return {
      paid: false,
      declined: true,
      intentId: intent?.intentId ?? null,
      reason: String(confirmation?.failureReason || "Payment declined"),
    };
  }

  const settled = toPaise(confirmation.amount);
  if (settled !== toPaise(amount)) {
    return {
      paid: false,
      declined: false,
      intentId: intent?.intentId ?? null,
      reason: `The gateway settled ${settled / 100} instead of ${toPaise(amount) / 100}`,
    };
  }
  // Only compared when the confirmation carries them: a gateway that echoes no
  // metadata is unusual, not a mismatch, and refusing every payment from one
  // would be a worse failure than the one this guards.
  if (confirmation.currency != null && String(confirmation.currency) !== String(currency)) {
    return {
      paid: false,
      declined: false,
      intentId: intent?.intentId ?? null,
      reason: "The gateway settled in a different currency",
    };
  }
  if (confirmation.metadata && String(confirmation.metadata.purchaseId ?? "") !== String(purchaseId)) {
    return {
      paid: false,
      declined: false,
      intentId: intent?.intentId ?? null,
      reason: "The gateway settled a different purchase",
    };
  }

  return {
    paid: true,
    intentId: intent?.intentId ?? null,
    reference: confirmation.reference ?? null,
  };
}

/**
 * Records a payment that came back declined, so the attempt is not invisible.
 *
 * The purchase row is the audit trail, and a declined card is a thing that really
 * happened: the buyer needs a receipt-shaped "no", and support needs to see the
 * attempt. Marking FAILED rather than deleting the row is also why the row is
 * written before the gateway is called at all.
 */
async function markPaymentFailed(purchaseId, { intentId, reference = null }) {
  await pool.query(
    `UPDATE ${PURCHASE_TABLE}
        SET payment_status = $1, status = $2, payment_intent_id = COALESCE($3, payment_intent_id),
            payment_reference = COALESCE($4, payment_reference), updated_at = now()
      WHERE id = $5`,
    [PAYMENT_STATUS.FAILED, PURCHASE_STATUS.CANCELLED, intentId, reference, purchaseId]
  );
}

/**
 * A gateway that answered, and not with PAID: a decline, or a settlement for the
 * wrong amount. Both are the same thing to the store — no money is owed and no
 * code may be issued — and neither is a claim about the buyer's card.
 */
async function markPaymentUnsucceeded(purchaseId, settlement) {
  return markPaymentFailed(purchaseId, {
    intentId: settlement.intentId,
    reference: settlement.reference ?? null,
  });
}

/**
 * Records that the money is in but nothing was issued.
 *
 * payment_status is restated as PAID here rather than left alone, and that is not
 * bookkeeping for its own sake: the PAID write happened inside the transaction
 * that just rolled back, so the row on disk is back to PENDING. PENDING would say
 * "we do not know whether this was charged", which is exactly what we do know —
 * the gateway confirmed it before the transaction ever opened. Restating it also
 * leaves the row refundable, because refundPurchase only acts on a paid purchase.
 *
 * status becomes CANCELLED, so the row reads "paid, never delivered" rather than
 * claiming a fulfilment that did not happen. The WHERE clause keeps a row that is
 * already REFUNDED or FAILED from being dragged back to PAID.
 *
 * gift_message is the buyer's own words and is left alone; there is no failure
 * column on the table, so the reason goes to the log instead, next to the ids
 * needed to find this row again.
 */
async function markIssuanceFailed(purchaseId, { intentId, reference = null, reason = null, template = null, quantity = 0, total = 0 } = {}) {
  // Nothing here is a code: the issuance path is handed a plaintext it never puts
  // in a message, and this line names the purchase, not the card.
  console.error("Gift card paid but not issued", {
    purchaseId,
    templateId: template ? Number(template.id) : null,
    quantity,
    total,
    reason: reason ? String(reason).slice(0, 300) : null,
  });
  await pool.query(
    `UPDATE ${PURCHASE_TABLE}
        SET payment_status = $1, status = $2, payment_intent_id = COALESCE($3, payment_intent_id),
            payment_reference = COALESCE($4, payment_reference), updated_at = now()
      WHERE id = $5 AND payment_status IN ($6, $1)`,
    [
      PAYMENT_STATUS.PAID,
      PURCHASE_STATUS.CANCELLED,
      intentId,
      reference,
      purchaseId,
      PAYMENT_STATUS.PENDING,
    ]
  );
}

/**
 * A gateway call that THREW rather than answering.
 *
 * Deliberately left PENDING, not marked FAILED: a timeout means nobody knows
 * whether the charge went through, and writing FAILED would assert that it did
 * not. An operator resolves it against the intent id recorded here. The row is
 * logged loudly instead, because an unresolved payment is money that may be
 * somebody's already.
 */
async function markPaymentUnresolved(purchaseId, { intentId, error }) {
  console.error("Gift card purchase payment unresolved", {
    purchaseId,
    intentId: intentId ?? null,
    reason: String(error?.message || error || "unknown").slice(0, 300),
  });
  await pool.query(
    `UPDATE ${PURCHASE_TABLE} SET payment_intent_id = COALESCE($1, payment_intent_id), updated_at = now() WHERE id = $2`,
    [intentId ?? null, purchaseId]
  );
}

/**
 * Buys `quantity` codes against a template. All of them, or none of them.
 *
 * The order of operations is the design, so it is worth stating flatly:
 *
 *   1. Load and check the template. Nothing is written and no money moves until it
 *      is known to be sellable, because a purchase row for an unsellable template
 *      is a row support has to explain.
 *   2. Write the purchase row as PENDING_PAYMENT, committed on its own. This is
 *      deliberately NOT in the transaction below: the gateway call sits between
 *      the two, and holding a transaction open across a network call is how a
 *      connection pool runs dry during a slow payment provider's worst minute. It
 *      is also what makes the declined path auditable — the row exists, with the
 *      intent id, before the buyer has been charged.
 *   3. Create the intent and confirm it, with no transaction open. Declined, or
 *      settled for the wrong amount: the row is marked FAILED and the caller is
 *      told. No code is issued on either path.
 *   4. In ONE transaction: flip the purchase to PAID/ISSUED, mint `quantity`
 *      codes, and write a delivery row for each. Any failure rolls all of it back,
 *      so there is no code without a purchase and no purchase that reads as
 *      issued while its codes are missing.
 *   5. Return the purchase and the plaintext codes. Once. The route shows them to
 *      the buyer; nothing in this file logs them, and the database never held
 *      them.
 *
 * `provider` accepts an already-built gateway (that is how the test suite forces a
 * decline through the sandbox's own failEvery hook) and `providerName` names one
 * from the payment registry otherwise. An unregistered name is refused rather than
 * defaulted, so a typo in a caller's configuration is a refusal and not a silent
 * charge to a sandbox that is not a real charge. `issueCodesInTx` replaces the
 * issuance loop for the same reason — see defaultIssueCodesInTx.
 *
 * Returns { purchase, codes, delivery, quantity, totalAmount, currency } where
 * `codes[i].code` is the plaintext. Throws PurchaseError with a stable `code` for
 * every refusal.
 */
export async function purchaseGiftCard({
  templateId,
  quantity,
  purchaserId = null,
  recipientEmail = null,
  recipientName = null,
  giftMessage = null,
  providerName = "sandbox",
  provider = null,
  issueCodesInTx = defaultIssueCodesInTx,
  now = new Date(),
} = {}) {
  const at = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();

  const purchaser = purchaserId == null || purchaserId === "" ? null : Number(purchaserId);
  const email = normalizeEmail(recipientEmail);
  const name = normalizeText(recipientName, 120);
  const message = normalizeText(giftMessage, 300);

  // A guest purchase is allowed — gift cards are the classic gift — but a code
  // with no destination is a code that will never be delivered and that the buyer
  // has to write down. An account holder's codes go to their own wallet history,
  // so they are the one case where no address is needed.
  if (!purchaser && !email) throw new PurchaseError(PURCHASE_REASON.RECIPIENT_REQUIRED);

  if (!provider && !registeredProviders().includes(String(providerName))) {
    throw new PurchaseError(PURCHASE_REASON.UNKNOWN_PAYMENT_PROVIDER);
  }

  const template = await loadTemplate(pool, templateId);
  if (!template) throw new PurchaseError(PURCHASE_REASON.TEMPLATE_NOT_FOUND);

  const facePaise = assertSellable(template, at);
  const count = assertQuantity(quantity, template);

  // What the buyer pays per card: the template's selling price when it has one,
  // its face value when it does not. A selling price below the face value is a
  // promotion, and 0 is a free card — both legal, both charged as asked.
  const sellingPrice = template.selling_price == null ? null : Number(template.selling_price);
  const unitChargePaise = sellingPrice != null && sellingPrice >= 0 ? toPaise(sellingPrice) : facePaise;
  const totalPaise = unitChargePaise * count;
  if (totalPaise > MAX_ORDER_TOTAL * 100) throw new PurchaseError(PURCHASE_REASON.PURCHASE_TOO_LARGE);

  const currency = String(template.currency || "INR");
  const total = round2(totalPaise / 100);

  // ---- 2. the purchase row, committed on its own, before any money moves -----
  const client = await pool.connect();
  let purchase;
  let purchaseUuid;
  try {
    const opened = await client.query(
      `INSERT INTO ${PURCHASE_TABLE}
         (purchaser_id, template_id, quantity, unit_face_value, unit_selling_price,
          total_amount, currency, payment_provider, recipient_email, recipient_name,
          gift_message, payment_status, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING ${PURCHASE_COLUMNS}`,
      [
        purchaser,
        Number(template.id),
        count,
        facePaise / 100,
        // Stored as given, so NULL keeps its documented meaning: this template
        // has no separate selling price and the buyer paid the face value.
        sellingPrice == null ? null : round2(sellingPrice),
        total,
        currency,
        String(providerName || "sandbox"),
        email || null,
        name,
        message,
        PAYMENT_STATUS.PENDING,
        PURCHASE_STATUS.PENDING_PAYMENT,
      ]
    );
    purchase = mapPurchase(opened.rows[0]);
    purchaseUuid = purchase.uuid;
  } finally {
    client.release();
  }

  // ---- 3. the gateway, with no transaction open ------------------------------
  const gateway = provider || createPaymentProvider(String(providerName || "sandbox"));
  let settlement;
  try {
    settlement = await takePayment(gateway, {
      amount: total,
      currency,
      template,
      purchaseId: purchaseUuid,
      quantity: count,
    });
  } catch (error) {
    await markPaymentUnresolved(purchase.id, { intentId: null, error });
    throw error;
  }

  if (!settlement.paid) {
    await markPaymentUnsucceeded(purchase.id, settlement);
    throw new PurchaseError(
      settlement.declined ? PURCHASE_REASON.PAYMENT_DECLINED : PURCHASE_REASON.PAYMENT_MISMATCH
    );
  }

  // ---- 4. one transaction: the purchase, its codes and their deliveries ------
  const issuer = await pool.connect();
  let codes = [];
  let deliveries = [];
  try {
    await issuer.query("BEGIN");

    // The guarded write, matching claimGiftCard's. The lock above is what makes a
    // race impossible; this is the backstop, so nothing can reach the code loop
    // without having been paid for.
    const settled = await issuer.query(
      `UPDATE ${PURCHASE_TABLE}
          SET payment_status = $1, status = $2, payment_intent_id = $3, payment_reference = $4,
              updated_at = now()
        WHERE id = $5 AND payment_status = $6
        RETURNING ${PURCHASE_COLUMNS}`,
      [PAYMENT_STATUS.PAID, PURCHASE_STATUS.ISSUED, settlement.intentId, settlement.reference, purchase.id, PAYMENT_STATUS.PENDING]
    );
    if (!settled.rows.length) {
      throw new Error(`Purchase ${purchase.id} was not awaiting payment when the gateway settled`);
    }
    purchase = mapPurchase(settled.rows[0]);

    codes = await issueCodesInTx(issuer, {
      templateId: Number(template.id),
      purchaseId: purchase.id,
      quantity: count,
      expiresAt: null,
    });

    for (const code of codes) {
      deliveries.push(
        await insertDelivery(issuer, {
          codeId: Number(code.id),
          purchaseId: purchase.id,
          recipientEmail: email,
          recipientName: name,
        })
      );
    }

    await issuer.query("COMMIT");
  } catch (error) {
    // Safe on an aborted connection: the failed statement has already poisoned
    // this transaction, so the rollback is best-effort by necessity.
    await issuer.query("ROLLBACK").catch(() => {});
    // The money IS in — the gateway confirmed it before this transaction opened.
    // So the purchase is left cancelled rather than issued, and the buyer is told
    // the truth: nothing was issued, and a human needs to return the money.
    await markIssuanceFailed(purchase.id, {
      intentId: settlement.intentId,
      reference: settlement.reference,
      reason: error?.message,
      template,
      quantity: count,
      total,
    }).catch(() => {});
    throw new PurchaseError(PURCHASE_REASON.ISSUANCE_FAILED);
  } finally {
    issuer.release();
  }

  return {
    purchase,
    quantity: count,
    totalAmount: total,
    currency,
    // The plaintext, once. `code` is the only field in this module that carries
    // one; the caller must put it in front of the buyer and drop it.
    codes: codes.map((code) => ({
      id: Number(code.id),
      uuid: code.uuid,
      code: code.code,
      codeLast4: code.code_last4,
      faceValue: round2(code.face_value),
      currency: code.currency,
      status: code.status,
      expiresAt: code.expires_at ?? null,
    })),
    delivery: deliveries.map((row) => ({
      id: Number(row.id),
      codeId: Number(row.code_id),
      status: row.status,
      channel: row.channel,
      recipientEmail: row.recipient_email || null,
    })),
  };
}

/**
 * Refunds a purchase and kills the codes it issued.
 *
 * THE RULE THAT MATTERS: a code that has already been claimed is NOT revoked.
 * Once claimed, its value is no longer the store's to take — it is sitting in a
 * customer's wallet bucket, and revoking the code would leave that money
 * unaccounted for and spendable-by-nobody at the same time. Reversing it has to
 * go through the wallet ledger (Wallet.debitInTx / refundInTx, the same path a
 * refunded order uses), not by voiding the card and hoping. That is exactly the
 * bug gift_card_codes' own CHECK (status <> 'REVOKED' OR claimed_by IS NULL)
 * exists to prevent, and GiftCardCode.revokeInTx refuses it too; here it is
 * checked up front so the refusal is a typed PurchaseError and the whole refund
 * rolls back rather than half-revoking a batch that also contains claimed codes.
 *
 * All-or-nothing, therefore: a purchase with one claimed code out of five cannot
 * be refunded here at all. That is deliberate — a partial refund is a wallet
 * operation plus a gateway operation, and this service does one of them, not the
 * other.
 *
 * Ordering: the codes and the purchase are flipped inside the transaction, and
 * the gateway refund is asked for after the commit. A gateway that then fails
 * leaves the cards dead and the money owed, which is the recoverable direction —
 * the reverse order could return money for cards that stayed live and spendable.
 */
export async function refundPurchase({ purchaseId, reason = null, performedBy = null, provider = null } = {}) {
  const client = await pool.connect();
  let purchase;
  let revoked;
  try {
    await client.query("BEGIN");

    const ref = typeof purchaseId === "string" ? purchaseId.trim() : purchaseId;
    if (ref == null || ref === "") throw new PurchaseError(PURCHASE_REASON.REFUND_NOT_FOUND);
    // Same two shapes as a template reference, for the same reason: an admin
    // screen holds the uuid and support holds the id.
    if (!UUID_RE.test(ref) && !/^\d+$/.test(String(ref))) {
      throw new PurchaseError(PURCHASE_REASON.REFUND_NOT_FOUND);
    }
    const found = await client.query(
      `SELECT ${PURCHASE_COLUMNS} FROM ${PURCHASE_TABLE}
        WHERE ${UUID_RE.test(ref) ? "uuid = $1::uuid" : "id = $1::bigint"}
        FOR UPDATE`,
      [ref]
    );
    purchase = mapPurchase(found.rows[0]);
    if (!purchase) throw new PurchaseError(PURCHASE_REASON.REFUND_NOT_FOUND);

    if (purchase.payment_status === PAYMENT_STATUS.REFUNDED || purchase.status === PURCHASE_STATUS.REFUNDED) {
      throw new PurchaseError(PURCHASE_REASON.REFUND_ALREADY_DONE);
    }
    if (purchase.payment_status !== PAYMENT_STATUS.PAID) {
      throw new PurchaseError(PURCHASE_REASON.REFUND_NOT_PAID);
    }

    // Locked in one ascending-id statement, the same order revokeInTx takes, so
    // two refunds of the same purchase queue rather than deadlock.
    const codes = await client.query(
      `SELECT id, code_last4, status, claimed_by FROM gift_card_codes
        WHERE purchase_id = $1 ORDER BY id FOR UPDATE`,
      [purchase.id]
    );

    const claimed = codes.rows.filter((row) => row.claimed_by != null);
    if (claimed.length) {
      throw new PurchaseError(PURCHASE_REASON.REFUND_CODE_CLAIMED);
    }

    revoked = [];
    const why = reason ? `Refunded: ${String(reason).slice(0, 200)}` : "Refunded";
    for (const row of codes.rows) {
      // revokeInTx is idempotent for an already-REVOKED code, so a retried
      // refund does not fail on a code it already killed.
      revoked.push(await GiftCardCode.revokeInTx(client, { id: Number(row.id), reason: why, performedBy }));
    }

    const updated = await client.query(
      `UPDATE ${PURCHASE_TABLE}
          SET status = $1, payment_status = $2, updated_at = now()
        WHERE id = $3 AND payment_status = $4
        RETURNING ${PURCHASE_COLUMNS}`,
      [PURCHASE_STATUS.REFUNDED, PAYMENT_STATUS.REFUNDED, purchase.id, PAYMENT_STATUS.PAID]
    );
    if (!updated.rows.length) {
      throw new Error(`Purchase ${purchase.id} changed underneath the refund`);
    }
    purchase = mapPurchase(updated.rows[0]);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  // Outside the transaction, and only once the codes are dead. A gateway failure
  // here is reported, never thrown: the caller has a committed refund to show and
  // a retry is safe because the codes are already REVOKED.
  let gatewayRefund = { attempted: false, status: null, error: null };
  if (purchase.payment_reference) {
    try {
      const gateway = provider || createPaymentProvider(purchase.payment_provider || "sandbox");
      const result = await gateway.refund(purchase.payment_reference, purchase.total_amount);
      gatewayRefund = {
        attempted: true,
        status: result?.status ?? null,
        reference: result?.reference ?? null,
        error: null,
      };
    } catch (error) {
      gatewayRefund = { attempted: true, status: null, error: String(error?.message || error) };
    }
  }

  return {
    purchase,
    revokedCodeIds: revoked.map((row) => Number(row.id)),
    revokedCount: revoked.length,
    gatewayRefund,
  };
}

/**
 * The caller's own purchases, with the codes shown as last4 only.
 *
 * The plaintext is not in the database and must not be in a list endpoint either:
 * this is the shape a shopper's order history page renders, so it must never be
 * the shape that can put a full code on a screen that somebody else can read over
 * a shoulder, or into a browser cache. last4 is what claimGiftCard's ledger rows
 * and the legacy wallet panel already treat as the safe display form.
 */
export async function listPurchasesForCustomer(customerId, { limit = 25 } = {}) {
  const id = customerId == null || customerId === "" ? null : Number(customerId);
  if (!Number.isFinite(id) || id <= 0) return [];
  const capped = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const result = await pool.query(
    `SELECT p.id, p.uuid, p.template_id, p.quantity, p.unit_face_value, p.unit_selling_price,
            p.total_amount, p.currency, p.payment_status, p.status, p.recipient_email,
            p.recipient_name, p.created_at,
            COALESCE(
              json_agg(
                json_build_object(
                  'codeLast4', c.code_last4,
                  'status', c.status,
                  'faceValue', c.face_value,
                  'expiresAt', c.expires_at
                ) ORDER BY c.id
              ) FILTER (WHERE c.id IS NOT NULL),
              '[]'::json
            ) AS codes
       FROM ${PURCHASE_TABLE} p
       LEFT JOIN gift_card_codes c ON c.purchase_id = p.id
      WHERE p.purchaser_id = $1
      GROUP BY p.id
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $2`,
    [id, capped]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    uuid: row.uuid,
    templateId: Number(row.template_id),
    quantity: Number(row.quantity),
    unitFaceValue: round2(row.unit_face_value),
    unitSellingPrice: row.unit_selling_price == null ? null : round2(row.unit_selling_price),
    totalAmount: round2(row.total_amount),
    currency: row.currency,
    paymentStatus: row.payment_status,
    status: row.status,
    recipientEmail: row.recipient_email || null,
    recipientName: row.recipient_name || null,
    createdAt: row.created_at,
    // last4 only. `code` is deliberately absent from this projection, so there is
    // no field to leak even if the join is widened later.
    codes: row.codes || [],
  }));
}