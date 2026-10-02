// What an admin is shown for one gift-card template, and the column list and
// status vocabulary behind it.
//
// It is a lib module rather than inline in the routes for the reason
// lib/giftCardTemplateScope.js is one: the routes under app/api/store/gift-cards
// import next/headers through lib/authorization, so plain Node — which is what the
// test suite is — cannot load them, and this is the part worth testing. Two routes
// need it too (the list and the single-template read), and a payload an admin
// screen renders from two shapes is how a field quietly appears in one and not
// the other.
//
// No `code` leaves this module in any form. The caller masks the raw row with
// GiftCard.maskRow before it gets here, which is what drops code_hash and replaces
// a plaintext code with a last4 stub; templatePayload has no field for one, so
// there is nothing to leak even if that step were forgotten.
import { round2 } from "./giftCardApplicability.js";
import { SELLABILITY_MESSAGE, sellabilityOf } from "./giftCardSellability.js";
import { describeScope } from "./giftCardTemplateScope.js";

export const TEMPLATE_TABLE = "gift_cards";
export const APPLICABILITY_TABLE = "gift_card_applicability";
export const CODES_TABLE = "gift_card_codes";

/**
 * Every status gift_cards.status accepts, mirroring the CHECK on the column
 * exactly: DRAFT, ACTIVE, SUSPENDED, CANCELLED, REDEEMED, ARCHIVED.
 *
 * NOT shared/constants.js's GIFT_CARD_STATUSES. That list predates the template
 * vocabulary and so has no ARCHIVED, while the column has admitted ARCHIVED since
 * migration 017 — a route that validated against it would refuse the one status
 * that means "retired", which is the status this whole screen exists to manage.
 * EXPIRED is deliberately absent for the reason it is absent everywhere else: it
 * is derived from expires_at at read time and is never stored.
 */
export const TEMPLATE_STATUSES = Object.freeze([
  "DRAFT",
  "ACTIVE",
  "SUSPENDED",
  "CANCELLED",
  "REDEEMED",
  "ARCHIVED",
]);

/**
 * The statuses that mean "this row is a product an admin manages", which is what
 * the list route returns.
 *
 * Everything else in the CHECK describes an ISSUED card that used to live in this
 * table — CANCELLED and REDEEMED are the two the old direct-spend system wrote.
 * A spent or revoked card is not a product, and a gift_cards row with issued
 * codes behind it is history rather than catalogue. So the list is ACTIVE plus
 * ARCHIVED: live products, plus the ones an admin has taken off sale and still
 * needs to be able to see, undo a mistake on, or read the issued-code count for.
 */
export const LISTABLE_STATUSES = Object.freeze(["ACTIVE", "ARCHIVED"]);

// The template's own columns, plus the three code columns so that whatever reads
// a template through here can mask it with GiftCard.maskRow — which is what drops
// code_hash and reduces any plaintext code to a last4 stub. Nothing about a
// customer: no recipient_email, no customer_id. This is the catalogue, not the
// issued card.
//
// A legacy issued card really does still carry a plaintext code in this table, so
// the code columns are fetched deliberately rather than left out. That makes
// masking the caller's obligation, which is why every function below that returns
// a template says so.
export const TEMPLATE_COLUMNS =
  "id, uuid, label, description, initial_amount, balance, currency, selling_price," +
  " face_value, validity_days, per_order_limit, max_quantity_per_order," +
  " starts_at, ends_at, expires_at, status, is_active, activated_at," +
  " created_at, updated_at, code, code_hash, code_last4";

const money = (value) => (value == null ? null : round2(value));

/**
 * One template as an admin screen wants it, including whether it can be sold and,
 * when it cannot, which column is the reason.
 *
 * `applicability` is the row-per-restriction form in the dialect checkout matches
 * — { kind, value } with kind in BRAND / CATEGORY / PRODUCT — exactly as the POST
 * route returned it, so the create response and the read-back are the same shape.
 * `scopeLabel` is describeScope's one-liner, for a confirmation the admin can
 * check against what they typed.
 *
 * `notSellableReason` is { code, message } rather than a bare code, because a
 * screen that renders "not sellable" with no column to fix makes the admin guess,
 * and guessing at a catalogue is how a ₹44 card ends up on sale at ₹44.
 */
export function templatePayload(row, { applicability = [], now = new Date() } = {}) {
  const check = sellabilityOf(row, now);
  return {
    id: Number(row.id),
    uuid: row.uuid,
    label: row.label,
    description: row.description ?? "",
    faceValue: money(row.face_value),
    sellingPrice: money(row.selling_price),
    // The two columns are reported side by side, and separately, precisely so an
    // admin can see when they have drifted: faceValue is what a buyer is
    // promised and initialAmount is what issueInTx actually stamps on a code.
    initialAmount: money(row.initial_amount),
    currency: row.currency || "INR",
    balance: money(row.balance),
    validityDays: row.validity_days == null ? null : Number(row.validity_days),
    perOrderLimit: money(row.per_order_limit),
    maxQuantityPerOrder:
      row.max_quantity_per_order == null ? null : Number(row.max_quantity_per_order),
    startsAt: row.starts_at ?? null,
    endsAt: row.ends_at ?? null,
    expiresAt: row.expires_at ?? null,
    status: row.status,
    isActive: row.is_active === true,
    isSellable: check.sellable,
    notSellableReason: check.sellable
      ? null
      : { code: check.reason, message: SELLABILITY_MESSAGE[check.reason] },
    // The ONLY code-derived field on a template, and it is there for a real
    // reason: an ARCHIVED legacy row is an issued card, and an admin looking at
    // one needs to know which card it was. It is the last4, never the plaintext —
    // the caller masks the row with GiftCard.maskRow (dropping code_hash and
    // reducing any plaintext code to a stub) and this module has no field that
    // could carry one, so there is nothing to leak even if that step were
    // forgotten.
    codeLast4: row.code_last4 || null,
    applicability,
    scopeLabel: describeScope(applicability),
    activatedAt: row.activated_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/**
 * Reads a template by public uuid or by internal id.
 *
 * Both are accepted because the admin panel holds ids and the storefront and the
 * emailed links hold uuids, and neither shape can be mistaken for the other — a
 * uuid never parses as a bigint. Anything else resolves to null rather than being
 * cast, so a garbage reference is a 404 and not a Postgres type error.
 *
 * The uuid shape is checked here rather than with lib/uuid.js's isValidUuid: that
 * module is a route helper (it also builds Responses) and imports cors
 * extensionlessly, so plain Node cannot resolve it. This is the same pattern, and
 * the same regex, as purchaseGiftCard.js's loadTemplate.
 *
 * `forUpdate` is for the write paths, and the row is read under the lock BEFORE
 * the request is validated against it. Two admins editing one template at once is
 * ordinary, and the last writer here would otherwise silently discard the other's
 * applicability rows — which is exactly the window a lock exists to close.
 *
 * THE RESULT IS UNMASKED. Every caller passes it through GiftCard.maskRow before
 * it reaches a response, and templatePayload has no field that could carry a
 * plaintext code — but the row here does hold one if the template is a legacy
 * issued card, so treat this as sensitive.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function templateRefKind(ref) {
  const value = typeof ref === "string" ? ref.trim() : ref;
  if (value == null || value === "") return null;
  if (UUID_RE.test(value)) return "uuid";
  if (/^\d+$/.test(String(value))) return "id";
  return null;
}

export async function findTemplate(db, ref, { forUpdate = false } = {}) {
  const kind = templateRefKind(ref);
  if (!kind) return null;
  const value = kind === "uuid" ? ref.trim() : Number(ref);
  const result = await db.query(
    `SELECT ${TEMPLATE_COLUMNS} FROM ${TEMPLATE_TABLE}
      WHERE ${kind === "uuid" ? "uuid = $1::uuid" : "id = $1::bigint"} LIMIT 1${
      forUpdate ? " FOR UPDATE" : ""
    }`,
    [value]
  );
  return result.rows[0] || null;
}

/**
 * One template's restrictions, as [{ kind, value }].
 *
 * Read with a LEFT JOIN LATERAL in the list query and separately here, because
 * the list needs every template's scope in one round trip while a single read can
 * afford its own. Both call this so the two cannot disagree on shape or order.
 */
export async function applicabilityFor(db, templateId, { client = null } = {}) {
  const runner = client || db;
  if (!templateId) return [];
  const result = await runner.query(
    `SELECT kind, value FROM ${APPLICABILITY_TABLE}
      WHERE template_id = $1 ORDER BY kind, value`,
    [Number(templateId)]
  );
  return result.rows.map((row) => ({ kind: row.kind, value: row.value }));
}

/** How many codes have ever been issued from one template, for the admin read. */
export async function issuedCodeCount(db, templateId, { client = null } = {}) {
  const runner = client || db;
  if (!templateId) return 0;
  const result = await runner.query(
    `SELECT count(*)::int AS n FROM ${CODES_TABLE} WHERE template_id = $1`,
    [Number(templateId)]
  );
  return result.rows[0]?.n ?? 0;
}
