import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { round2, toPaise } from "@/lib/giftCardApplicability";
import {
  KIND_LABEL,
  resolveScopeRows,
  scopeRowsFrom,
  writeScopeRows,
} from "@/lib/giftCardTemplateScope";
import { GiftCard } from "@/lib/models/giftCard";
import {
  TEMPLATE_COLUMNS,
  TEMPLATE_STATUSES,
  TEMPLATE_TABLE,
  applicabilityFor,
  findTemplate,
  issuedCodeCount,
  templatePayload,
} from "@/lib/giftCardTemplateView";

export const runtime = "nodejs";

// Read, edit and retire ONE gift-card template.
//
// Three routes, one rule that explains all of them: this table is the CATALOGUE.
// A row here is a product an admin decides to sell, not a card somebody holds, so
// editing it changes what may be bought and retiring it must not destroy a card
// that has already been bought. Which is why DELETE archives.
//
// Every reference below — [id] in the URL — accepts either the internal id or the
// public uuid, because the admin panel holds ids and an emailed link holds a uuid,
// and neither can be mistaken for the other.

// The same failure envelope as the sibling route's fail(). Written out rather than
// imported, because importing a route module into another route module pulls in a
// second set of route handlers for no benefit.
function fail(code, message, status) {
  return Response.json({ success: false, code, message }, { status, headers: corsHeaders() });
}

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

function notFound() {
  return fail("TEMPLATE_NOT_FOUND", "Gift card not found.", 404);
}

// A row as the admin screen renders it, masked, with its scope and the count of
// codes ever issued from it.
//
// issuedCodeCount is here because it is the fact that decides what DELETE below
// is allowed to do, and an admin deciding to retire a card should see it first.
// Always read on the pool and never on the caller's transaction: it runs after the
// COMMIT, so the rows it counts are the ones that were actually written.
async function payloadFor(row) {
  const applicability = await applicabilityFor(pool, row.id);
  return {
    ...templatePayload(GiftCard.maskRow(row), { applicability }),
    issuedCodes: await issuedCodeCount(pool, row.id),
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// GET /api/store/gift-cards/templates/[id] — one template with its scope,
// behind gift_cards.view.
export async function GET(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.GIFT_CARDS_VIEW);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const row = await findTemplate(pool, id);
    // A reference that is neither a uuid nor an id is a 404 rather than a 400,
    // matching app/api/gift-cards/[id]/route.js: a caller who may read every
    // template must not be able to probe which references exist by reading the
    // difference between "malformed" and "missing".
    if (!row) return notFound();

    return Response.json(
      { success: true, template: await payloadFor(row) },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Get gift card template error:", error);
    return fail("TEMPLATE_READ_FAILED", "Could not load this gift card.", 500);
  }
}

// PATCH /api/store/gift-cards/templates/[id] — update one template, behind
// gift_cards.update.
//
// Only the catalogue side is editable here. balance and initial_amount-as-money
// are not: money moves through GiftCard.adjust (ledgered) or through an issued
// code, never by an edit to a column, and a direct write would orphan the
// transaction ledger that records every movement.
//
// THE face_value / initial_amount RULE, which is the reason this route is more
// than a thin UPDATE:
//
// issueInTx stamps a code's value from `initial_amount`, not from `face_value`.
// initial_amount is the legacy column and that behaviour is fixed and tested, so
// the two columns are the same number in two places and an edit that moves one
// without the other produces a template that advertises ₹500 and delivers ₹44 —
// and lib/giftCardSellability.js refuses to sell it, with a message that is only
// useful if the admin knows which edit caused it. So a faceValue edit writes BOTH
// columns from the one number the admin typed, and the one way an edit CAN break
// the pair — sending initialAmount on its own — is refused outright rather than
// half-applied.
//
// An edit that touches neither column is never refused for this, which is what
// keeps a broken template repairable: a label fix, and an archive, both work on a
// row whose two value columns already disagree.
export async function PATCH(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.GIFT_CARDS_UPDATE);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    // Everything answerable without the database is answered first, so a
    // malformed body costs no connection — and, more importantly, so a template
    // is not locked FOR UPDATE by a request that was never going to be applied.
    const has = (camel, snake) => body[camel] !== undefined || body[snake] !== undefined;

    const fields = [];
    const values = [];
    const set = (column, value) => {
      fields.push(`${column} = $${values.length + 1}`);
      values.push(value);
    };

    if (has("label", "label")) {
      const label = String(body.label == null ? "" : body.label).trim().slice(0, 60);
      if (!label) return fail("INVALID_LABEL", "A gift card needs a label.", 400);
      set("label", label);
    }

    if (has("description", "description")) {
      set("description", String(body.description == null ? "" : body.description).trim().slice(0, 500));
    }

    if (has("sellingPrice", "selling_price")) {
      const selling = optionalMoney(body.sellingPrice ?? body.selling_price, {
        field: "sellingPrice",
        min: 0,
      });
      if (selling.error) return fail("INVALID_SELLING_PRICE", selling.error, 400);
      set("selling_price", selling.value);
    }

    if (has("validityDays", "validity_days")) {
      const validity = optionalPositiveInt(body.validityDays ?? body.validity_days, "validityDays");
      if (validity.error) return fail("INVALID_VALIDITY_DAYS", validity.error, 400);
      set("validity_days", validity.value);
    }

    if (has("perOrderLimit", "per_order_limit")) {
      const perOrder = optionalMoney(body.perOrderLimit ?? body.per_order_limit, {
        field: "perOrderLimit",
        min: 0,
      });
      if (perOrder.error) return fail("INVALID_PER_ORDER_LIMIT", perOrder.error, 400);
      set("per_order_limit", perOrder.value);
    }

    if (has("maxQuantityPerOrder", "max_quantity_per_order")) {
      const maxQty = optionalPositiveInt(
        body.maxQuantityPerOrder ?? body.max_quantity_per_order,
        "maxQuantityPerOrder"
      );
      if (maxQty.error) return fail("INVALID_MAX_QUANTITY", maxQty.error, 400);
      set("max_quantity_per_order", maxQty.value);
    }

    // The window is ONE CHECK on the table, so it is validated as a pair below
    // rather than as two independent edits — otherwise a bad pair surfaces as a
    // bare constraint violation and the admin is told nothing useful. Parsed once,
    // here, because both the write and the check need the same answer.
    let parsedStarts = null;
    let parsedEnds = null;
    if (has("startsAt", "starts_at")) {
      const starts = optionalTimestamp(body.startsAt ?? body.starts_at, "startsAt");
      if (starts.error) return fail("INVALID_STARTS_AT", starts.error, 400);
      parsedStarts = starts.value;
      set("starts_at", starts.value);
    }
    if (has("endsAt", "ends_at")) {
      const ends = optionalTimestamp(body.endsAt ?? body.ends_at, "endsAt");
      if (ends.error) return fail("INVALID_ENDS_AT", ends.error, 400);
      parsedEnds = ends.value;
      set("ends_at", ends.value);
    }

    if (has("isActive", "is_active")) {
      // Strictly true/false. "false" as a string is refused rather than coerced,
      // because which of the two an admin meant is a question and the answer
      // changes whether the storefront can sell the card.
      const raw = body.isActive ?? body.is_active;
      if (typeof raw !== "boolean") {
        return fail("INVALID_IS_ACTIVE", "isActive must be true or false.", 400);
      }
      set("is_active", raw);
    }

    let status = null;
    if (has("status", "status")) {
      const raw = String(body.status ?? "").trim().toUpperCase();
      // Validated against the column's own CHECK. EXPIRED is refused on purpose:
      // it is derived from expires_at at read time and is never stored, so
      // accepting it would write a value that reads as something else.
      if (!TEMPLATE_STATUSES.includes(raw)) {
        return fail(
          "INVALID_STATUS",
          `status must be one of ${TEMPLATE_STATUSES.join(", ")}. EXPIRED is derived from expires_at and is never stored.`,
          400
        );
      }
      status = raw;
    }

    // The value pair, parsed here so a refusal costs nothing: no connection is
    // taken and no row is locked for a body that was never going to be applied.
    const faceGiven = has("faceValue", "face_value");
    const initialGiven = has("initialAmount", "initial_amount");

    const face = faceGiven
      ? optionalMoney(body.faceValue ?? body.face_value, { field: "faceValue", min: 0 })
      : { value: null, error: null };
    if (face.error) return fail("INVALID_FACE_VALUE", face.error, 400);

    const initial = initialGiven
      ? optionalMoney(body.initialAmount ?? body.initial_amount, { field: "initialAmount", min: 0 })
      : { value: null, error: null };
    if (initial.error) return fail("INVALID_INITIAL_AMOUNT", initial.error, 400);

    // Explicitly clearing the face value is refused rather than allowed to write
    // a NULL. initial_amount is NOT NULL, has no "unset" reading, and is what
    // issueInTx stamps; a template with a cleared face value cannot be sold and
    // cannot be repaired by another edit without typing the number again.
    if (faceGiven && face.value == null) {
      return fail(
        "FACE_VALUE_REQUIRED",
        "faceValue cannot be cleared. Set it to a positive amount, or take the template off sale with status: ARCHIVED.",
        400
      );
    }
    if (faceGiven && !(face.value > 0)) {
      return fail("INVALID_FACE_VALUE", "faceValue must be greater than zero.", 400);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const locked = await findTemplate(client, id, { forUpdate: true });
      if (!locked) {
        await client.query("ROLLBACK");
        return notFound();
      }

      // The sell window, merged with whatever the row already holds, so a change
      // to one end of it is checked against the other.
      const windowStarts = parsedStarts === null ? locked.starts_at : parsedStarts;
      const windowEnds = parsedEnds === null ? locked.ends_at : parsedEnds;
      if (windowStarts && windowEnds && new Date(windowEnds).getTime() <= new Date(windowStarts).getTime()) {
        await client.query("ROLLBACK");
        return fail("INVALID_SELL_WINDOW", "endsAt must be after startsAt.", 400);
      }

      // THE AGREEMENT. The only way an edit can break it is by moving one of the two
      // columns without the other, and that happens in exactly one case: the body
      // sent initialAmount on its own. So that is the case checked — against the
      // LOCKED row's face_value, in integer paise, because a NUMERIC that came
      // back from pg as a string must not fail the check for the wrong reason.
      //
      // Note what is deliberately NOT refused: an edit that touches neither
      // column. A label fix on a template that is already inconsistent is a real
      // thing an admin has to be able to do, and so is archiving one — a screen
      // that could not switch a broken card off would be worse than the bug.
      if (initialGiven && !faceGiven && toPaise(initial.value) !== toPaise(locked.face_value)) {
        await client.query("ROLLBACK");
        return fail(
          "TEMPLATE_VALUE_MISMATCH",
          `faceValue and initialAmount must be the same number, because a code is issued for initialAmount and not for faceValue. ` +
            `This edit would leave faceValue at ${locked.face_value == null ? "nothing" : round2(locked.face_value)} and initialAmount at ` +
            `${initial.value == null ? "nothing" : round2(initial.value)}. Send faceValue on its own and both columns are written from it.`,
          409
        );
      }

      if (faceGiven) {
        // One number, two columns. Not a default and not a trigger: the same
        // expression on both sides is what makes them unable to drift.
        set("face_value", face.value);
        set("initial_amount", face.value);
      } else if (initialGiven) {
        // Only reachable because it matched the stored face value above. Written
        // anyway so a request can never end in a state one column was part of and
        // the other silently was not.
        set("initial_amount", initial.value);
      }

      if (status != null) {
        set("status", status);
        // First activation stamps the moment the card became usable, matching
        // GiftCard.update.
        if (status === "ACTIVE") fields.push("activated_at = COALESCE(activated_at, now())");
      }

      const updated =
        fields.length === 0
          ? locked
          : (
              await client.query(
                `UPDATE ${TEMPLATE_TABLE}
                    SET ${fields.join(", ")}, updated_at = now()
                  WHERE id = $${values.length + 1}
                  RETURNING ${TEMPLATE_COLUMNS}`,
                [...values, Number(locked.id)]
              )
            ).rows[0];

      // Applicability is REPLACED, never appended. An admin editing a template's
      // restrictions is describing what the card is now for, not adding to a list
      // they cannot see the whole of; appending would make "remove this brand"
      // impossible to express and would grow the row on every save. It is also
      // safe to change freely: a code freezes its scope onto the customer's
      // wallet bucket at claim time, so an edit here only ever affects codes
      // issued from now on.
      const applicabilityGiven = has("applicability", "scope");
      let restrictions = null;
      if (applicabilityGiven) {
        const parsed = scopeRowsFrom(body.applicability ?? body.scope);
        if (parsed.error) {
          await client.query("ROLLBACK");
          return fail("INVALID_APPLICABILITY", parsed.error, 400);
        }
        // Resolved INSIDE this transaction for the same reason the POST route
        // does: checked outside it, a brand could be renamed between the check
        // and the insert and the card would ship with a restriction matching
        // nothing.
        const outcome = await resolveScopeRows(client, parsed.rows);
        if (outcome.error) {
          await client.query("ROLLBACK");
          const problem = outcome.error;
          if (problem.reason === "unknown_kind") {
            return fail("INVALID_APPLICABILITY", "kind must be BRAND, CATEGORY or PRODUCT.", 400);
          }
          return fail(
            "APPLICABILITY_NOT_FOUND",
            problem.kind === "PRODUCT"
              ? `No product with that id: ${problem.value}`
              : `No ${KIND_LABEL[problem.kind]} named "${problem.value}"`,
            400
          );
        }
        restrictions = outcome.resolved;

        // Delete and insert in one transaction, and against the locked row, so a
        // second admin saving at the same moment cannot read this template's rows
        // between the two halves and write a union of the two scopes.
        await client.query(`DELETE FROM gift_card_applicability WHERE template_id = $1`, [
          Number(locked.id),
        ]);
        await writeScopeRows(client, locked.id, restrictions);
      }

      await client.query("COMMIT");

      const payload = await payloadFor(updated);

      console.info("Gift card template updated", {
        templateId: Number(updated.id),
        uuid: updated.uuid,
        fields: fields.length,
        restrictions: restrictions ? restrictions.length : undefined,
        updatedBy: auth.user?.id ?? null,
      });

      return Response.json(
        {
          success: true,
          message: "Gift card updated.",
          template: payload,
        },
        { status: 200, headers: corsHeaders() }
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      // A CHECK the route could not pre-check is still the user's fault, not a
      // server fault, and answering 500 for it would be a lie: it tells the admin
      // to retry something that will fail identically.
      if (String(error?.code) === "23514") {
        return fail("CONSTRAINT_REFUSED", "The database refused that change. Check the values.", 400);
      }
      if (String(error?.code) === "23503") {
        return fail("REFERENCE_REFUSED", "That change refers to something that does not exist.", 400);
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Update gift card template error:", error);
    return fail("TEMPLATE_UPDATE_FAILED", "Could not update this gift card.", 500);
  }
}

// DELETE /api/store/gift-cards/templates/[id] — RETIRE a template, behind
// gift_cards.delete.
//
// IT DOES NOT DELETE. It archives, and that is the correct behaviour rather than a
// softened one. Four rows point at gift_cards.id today and a real DELETE would do
// one of four things, none of them good:
//
//   * gift_card_codes.template_id    ON DELETE RESTRICT — hard failure for any
//     template that has ever sold, which is every template anybody cared about.
//   * gift_card_purchases.template_id ON DELETE RESTRICT — same, and a purchase
//     row is a record of money a customer paid.
//   * orders.gift_card_id            ON DELETE SET NULL — the redemption stops
//     saying which card paid for it, so an order refund stops being traceable.
//   * gift_card_transactions.gift_card_id ON DELETE CASCADE — the entire
//     stored-value ledger for the card, silently, with no error at all.
//
// So a template that has issued codes cannot be deleted, and a template that has
// not still should not be: an ARCHIVED row keeps its label, its price and its
// issued-code count, so next quarter somebody can answer "what was the ₹250
// card" without it having vanished. There is no case where destroying the record
// is what the admin wanted; there is only a case where they wanted it OFF SALE.
//
// is_active goes false as well as the status, because status is the history and
// is_active is the gate — and the gate is what a later accidental status flip
// would otherwise walk straight back through.
//
// The message says "archived", not "deleted", so the UI and the admin's
// expectation do not diverge from what actually happened.
export async function DELETE(request, { params }) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.GIFT_CARDS_DELETE);
    if (!auth.ok) return auth.response;

    const { id } = await params;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const locked = await findTemplate(client, id, { forUpdate: true });
      if (!locked) {
        await client.query("ROLLBACK");
        return notFound();
      }

      const codes = await issuedCodeCount(client, locked.id);
      const alreadyArchived = locked.status === "ARCHIVED";

      const archived = (
        await client.query(
          `UPDATE ${TEMPLATE_TABLE}
              SET status = 'ARCHIVED', is_active = FALSE, updated_at = now()
            WHERE id = $1
            RETURNING ${TEMPLATE_COLUMNS}`,
          [Number(locked.id)]
        )
      ).rows[0];

      await client.query("COMMIT");

      const payload = await payloadFor(archived);

      console.info("Gift card template archived (not deleted)", {
        templateId: Number(archived.id),
        uuid: archived.uuid,
        issuedCodes: codes,
        wasAlreadyArchived: alreadyArchived,
        archivedBy: auth.user?.id ?? null,
      });

      return Response.json(
        {
          success: true,
          archived: true,
          // Named twice over, deliberately: `archived` is the machine-readable
          // flag and the message is what the admin actually reads. Neither says
          // "deleted", because nothing was.
          message: alreadyArchived
            ? "This gift card was already archived. It is off sale and its issued codes are untouched."
            : codes > 0
              ? `Gift card archived. Its ${codes} issued code${codes === 1 ? "" : "s"} and all its history are untouched.`
              : "Gift card archived. It has never issued a code, and archiving rather than deleting keeps its history readable.",
          template: payload,
        },
        { status: 200, headers: corsHeaders() }
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Archive gift card template error:", error);
    return fail("TEMPLATE_ARCHIVE_FAILED", "Could not archive this gift card.", 500);
  }
}
