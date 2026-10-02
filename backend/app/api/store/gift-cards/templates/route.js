import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { parsePagination, paginate } from "@/lib/pagination";
import { GiftCard } from "@/lib/models/giftCard";
import { KEY_PERMISSIONS } from "@shared/constants";
import { round2 } from "@/lib/giftCardApplicability";
import {
  KIND_LABEL,
  describeScope,
  resolveScopeRows,
  scopeRowsFrom,
  writeScopeRows,
} from "@/lib/giftCardTemplateScope";
import {
  APPLICABILITY_TABLE,
  LISTABLE_STATUSES,
  TEMPLATE_COLUMNS,
  TEMPLATE_STATUSES,
  TEMPLATE_TABLE,
  templatePayload,
} from "@/lib/giftCardTemplateView";

export const runtime = "nodejs";

// The TEMPLATE endpoints — the gift cards an admin manages as products.
//
// GET lists them, POST creates one, and [id]/route.js reads, edits and retires
// one. What they all share is that gift_cards is the TEMPLATE table: the thing a
// shopper buys, not the card they hold. That distinction is the whole reason this
// screen exists as its own thing — see the sibling routes for the issued cards.

// Creates a gift card TEMPLATE — the thing a shopper buys — and nothing else.
//
// Why this exists: the storefront can redeem a code and nothing in the app
// issues one, because no row in gift_cards has a face_value and no row exists in
// gift_card_applicability at all. Every one of those is an admin decision, so this
// is the admin's endpoint for making one — on the store path because that is
// where the rest of the gift-card surface lives, but behind
// gift_cards.create like any other catalogue write.
//
// A created template is ACTIVE and is_active, because a card that cannot be sold
// should not be creatable: the update route is how a card is paused or archived.
// Nothing here creates a code, so this route cannot mint money by itself.

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function fail(code, message, status) {
  return Response.json({ success: false, code, message }, { status, headers: corsHeaders() });
}

// TEMPLATE_COLUMNS, prefixed for the aliased list query below. Written as a map
// rather than string surgery so a column added to the view module is picked up
// here automatically. It carries the three code columns, which is deliberate:
// this list is exactly where a legacy issued card — which really does hold a
// plaintext code in this table — shows up, and GiftCard.maskRow below has to have
// something real to mask rather than a projection that happened to leave it out.
const prefixed = (columns) => columns.split(", ").map((column) => `t.${column}`).join(", ");
const LIST_COLUMNS = prefixed(TEMPLATE_COLUMNS);

function optionalMoney(raw, { field, min = 0 }) {
  if (raw == null || raw === "") return { value: null, error: null };
  // The input is parsed and checked BEFORE round2, and that order is the whole
  // point: toPaise maps anything non-finite to 0, so round2("free") is 0 — a
  // finite number that sails through a Number.isFinite check and writes a
  // zero-price gift card to the catalogue. One rounding helper must not become a
  // way to smuggle a non-number past a validator.
  if (typeof raw !== "number" && typeof raw !== "string") {
    return { value: null, error: `${field} is not a number.` };
  }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return { value: null, error: `${field} is not a number.` };
  const amount = round2(numeric);
  if (amount < min) return { value: null, error: `${field} must be at least ${min}.` };
  return { value: amount, error: null };
}

function optionalPositiveInt(raw, field) {
  if (raw == null || raw === "") return { value: null, error: null };
  const parsed = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return { value: null, error: `${field} must be a whole number greater than zero.` };
  }
  return { value: parsed, error: null };
}

function optionalTimestamp(raw, field) {
  if (raw == null || raw === "") return { value: null, error: null };
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) return { value: null, error: `${field} is not a valid date.` };
  return { value: when, error: null };
}

// GET /api/store/gift-cards/templates — every template, paginated like the
// existing admin list (app/api/gift-cards/route.js), behind gift_cards.view.
//
// ONLY REAL TEMPLATES. That filter is the reason this endpoint exists separately
// from the admin cards list. gift_cards is the template table but it still holds
// the seven legacy rows from the old direct-spend system, and every one of them
// was an ISSUED card rather than a product: five of them were moved into
// gift_card_codes by migration 017 and the other two were issued from the panel
// afterwards. CANCELLED and REDEEMED — the two statuses in the CHECK that
// describe such a card — are therefore excluded, so a spent or revoked card can
// never be rendered here as a thing for sale. ARCHIVED is kept, because that is
// the status a RETIRED template carries and an admin has to be able to see those
// to undo a mistake.
//
// Each row carries isSellable plus, when it is false, the reason and the column to
// fix — from lib/giftCardSellability.js, which is the same function
// purchaseGiftCard.js refuses a sale with. A dead row with no explanation is how a
// template stays broken for a year.
export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.GIFT_CARDS_VIEW);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const search = (searchParams.get("search") ?? "").trim();
    const statusFilter = (searchParams.get("status") ?? "").trim().toUpperCase();
    const { page, limit, offset } = parsePagination(searchParams);

    // Validated against the column's own CHECK, so a typo is a 400 rather than a
    // silently empty list somebody reads as "there are none".
    if (statusFilter && !TEMPLATE_STATUSES.includes(statusFilter)) {
      return fail("INVALID_STATUS", `status must be one of ${TEMPLATE_STATUSES.join(", ")}.`, 400);
    }
    // A status filter is INTERSECTED with the listable vocabulary, never
    // substituted for it: a filter on a real-but-unlistable status is a question
    // about retired legacy cards, and answering it with those rows would put spent
    // money back on the catalogue screen. The honest answer to that is an EMPTY
    // list — not the whole catalogue, which is what falling back to the default
    // would silently return and let the admin read as "they are all fine".
    const statuses = !statusFilter
      ? [...LISTABLE_STATUSES]
      : LISTABLE_STATUSES.includes(statusFilter)
        ? [statusFilter]
        : [];

    const params = [statuses];
    const conditions = [`t.status = ANY($1::text[])`];

    if (search) {
      params.push(`%${search}%`);
      const like = `$${params.length}`;
      // code_last4 and not code: the plaintext code is never matched on, because
      // searching by it and then masking the result would still put a guessable
      // card in a URL and a query log.
      conditions.push(`(t.label ILIKE ${like} OR t.description ILIKE ${like} OR t.code_last4 ILIKE ${like})`);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const { rows, pagination } = await paginate(
      {
        baseSql: `SELECT ${LIST_COLUMNS},
                         COALESCE(scope.rows, '[]'::json) AS applicability
                    FROM ${TEMPLATE_TABLE} t
                    LEFT JOIN LATERAL (
                      SELECT json_agg(json_build_object('kind', a.kind, 'value', a.value)
                                      ORDER BY a.kind, a.value) AS rows
                        FROM ${APPLICABILITY_TABLE} a
                       WHERE a.template_id = t.id
                    ) scope ON TRUE
                    ${where}`,
        countSql: `SELECT count(*)::int AS count FROM ${TEMPLATE_TABLE} t ${where}`,
        params,
        // Same ordering as the admin cards list, so a support agent moving between
        // the two screens is not looking at two different lists.
        orderBy: "ORDER BY t.created_at DESC, t.id DESC",
      },
      { page, limit, offset }
    );

    const now = new Date();
    const templates = rows.map((row) =>
      // Mask first, then shape: maskRow drops code_hash and turns a plaintext code
      // into a last4 stub, and templatePayload has no field that could carry one.
      templatePayload(GiftCard.maskRow(row), { applicability: row.applicability || [], now })
    );

    return Response.json(
      { success: true, templates, pagination },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("List gift card templates error:", error);
    return fail("TEMPLATE_LIST_FAILED", "Could not load these gift cards.", 500);
  }
}

// POST /api/store/gift-cards/templates — create one sellable gift card template.
//
// Admin-authenticated, gift_cards.create, exactly as the other gift-card writes
// are: app/api/gift-cards/denominations/route.js is the pattern this copies.
//
// Validation is split in two on purpose. Everything that can be answered without
// a query is answered first (so a malformed body costs no connection), then the
// applicability values are resolved INSIDE the transaction that writes the rows.
// Checking them outside would leave a window in which a brand is renamed between
// the check and the insert, and the card would ship with a restriction that
// matches nothing.
export async function POST(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.GIFT_CARDS_CREATE);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));

    const label = String(body.label == null ? "" : body.label).trim().slice(0, 60);
    if (!label) return fail("INVALID_LABEL", "A gift card needs a label.", 400);

    const description = String(body.description == null ? "" : body.description).trim().slice(0, 500);

    // face_value is what a buyer is promised. The template also keeps the legacy
    // initial_amount in step with it below, because that is the column
    // GiftCardCode.issueInTx reads when it stamps a code — a template whose two
    // value columns disagree would sell one number and deliver another.
    const face = optionalMoney(body.faceValue ?? body.face_value, { field: "faceValue", min: 0 });
    if (face.error) return fail("INVALID_FACE_VALUE", face.error, 400);
    if (!(face.value > 0)) {
      return fail("INVALID_FACE_VALUE", "faceValue must be greater than zero.", 400);
    }

    const selling = optionalMoney(body.sellingPrice ?? body.selling_price, { field: "sellingPrice", min: 0 });
    if (selling.error) return fail("INVALID_SELLING_PRICE", selling.error, 400);

    const validity = optionalPositiveInt(body.validityDays ?? body.validity_days, "validityDays");
    if (validity.error) return fail("INVALID_VALIDITY_DAYS", validity.error, 400);

    const perOrder = optionalMoney(body.perOrderLimit ?? body.per_order_limit, { field: "perOrderLimit", min: 0 });
    if (perOrder.error) return fail("INVALID_PER_ORDER_LIMIT", perOrder.error, 400);

    const maxQty = optionalPositiveInt(
      body.maxQuantityPerOrder ?? body.max_quantity_per_order,
      "maxQuantityPerOrder"
    );
    if (maxQty.error) return fail("INVALID_MAX_QUANTITY", maxQty.error, 400);

    const starts = optionalTimestamp(body.startsAt ?? body.starts_at, "startsAt");
    if (starts.error) return fail("INVALID_STARTS_AT", starts.error, 400);
    const ends = optionalTimestamp(body.endsAt ?? body.ends_at, "endsAt");
    if (ends.error) return fail("INVALID_ENDS_AT", ends.error, 400);
    if (starts.value && ends.value && ends.value.getTime() <= starts.value.getTime()) {
      return fail("INVALID_SELL_WINDOW", "endsAt must be after startsAt.", 400);
    }

    const applicability = scopeRowsFrom(body.applicability ?? body.scope);
    if (applicability.error) return fail("INVALID_APPLICABILITY", applicability.error, 400);

    const currency = String(body.currency || "INR").trim().toUpperCase().slice(0, 8) || "INR";

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Resolve every restriction before writing anything, so a typo rolls the
      // whole create back rather than leaving a template whose money is stuck.
      // Inside this transaction on purpose: checked outside, a brand could be
      // renamed between the check and the insert and the card would ship with a
      // restriction that matches nothing.
      const { resolved, error: scopeError } = await resolveScopeRows(client, applicability.rows);
      if (scopeError) {
        await client.query("ROLLBACK").catch(() => {});
        if (scopeError.reason === "unknown_kind") {
          return fail("INVALID_APPLICABILITY", "kind must be BRAND, CATEGORY or PRODUCT.", 400);
        }
        return fail(
          "APPLICABILITY_NOT_FOUND",
          scopeError.kind === "PRODUCT"
            ? `No product with that id: ${scopeError.value}`
            : `No ${KIND_LABEL[scopeError.kind]} named "${scopeError.value}"`,
          400
        );
      }

      const created = await client.query(
        `INSERT INTO ${TEMPLATE_TABLE}
           (label, description, initial_amount, balance, currency, selling_price,
            face_value, validity_days, per_order_limit, max_quantity_per_order,
            starts_at, ends_at, status, is_active, created_by, activated_at)
         VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'ACTIVE', TRUE, $12, now())
         RETURNING id, uuid, label, description, initial_amount, currency, selling_price,
                   face_value, validity_days, per_order_limit, max_quantity_per_order,
                   starts_at, ends_at, status, is_active, created_at`,
        [
          label,
          description,
          face.value,
          currency,
          // NULL keeps its documented meaning on gift_card_purchases and here:
          // no separate price, so the buyer pays the face value.
          selling.value,
          face.value,
          validity.value,
          perOrder.value,
          maxQty.value,
          starts.value,
          ends.value,
          auth.user.id,
        ]
      );
      const template = created.rows[0];

      await writeScopeRows(client, template.id, resolved);

      await client.query("COMMIT");

      console.info("Gift card template created", {
        templateId: Number(template.id),
        uuid: template.uuid,
        faceValue: face.value,
        sellingPrice: selling.value,
        restrictions: resolved.length,
        createdBy: auth.user.id,
      });

      return Response.json(
        {
          success: true,
          message: "Gift card created.",
          template: {
            id: Number(template.id),
            uuid: template.uuid,
            label: template.label,
            description: template.description,
            faceValue: round2(template.face_value),
            sellingPrice: template.selling_price == null ? null : round2(template.selling_price),
            currency: template.currency,
            validityDays: template.validity_days == null ? null : Number(template.validity_days),
            perOrderLimit:
              template.per_order_limit == null ? null : round2(template.per_order_limit),
            maxQuantityPerOrder:
              template.max_quantity_per_order == null ? null : Number(template.max_quantity_per_order),
            startsAt: template.starts_at,
            endsAt: template.ends_at,
            status: template.status,
            isActive: template.is_active,
            createdAt: template.created_at,
            // The restrictions in the dialect checkout matches, so a reader can
            // confirm the card spends where they think it does, plus the same
            // one-line summary the shopper's wallet shows for a claimed bucket.
            applicability: resolved,
            scopeLabel: describeScope(resolved),
          },
        },
        { status: 201, headers: corsHeaders() }
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Create gift card template error:", error);
    return fail(
      "TEMPLATE_CREATE_FAILED",
      "Could not create this gift card.",
      500
    );
  }
}