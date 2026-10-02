// ONE decision about whether a gift-card template may be sold, in ONE place.
//
// This exists because two callers need the same answer and would otherwise each
// grow their own copy: lib/services/purchaseGiftCard.js, which refuses a purchase,
// and the admin template routes, which have to say out loud why an admin cannot
// sell a template. They drifted once already — a NULL face_value is the only
// thing stopping the storefront from selling card 22 as a ₹44 product, and that
// was an accident of the data rather than a rule anybody wrote down.
//
// So this module owns the RULES. It does not own the wording: the shopper-facing
// sentences stay in purchaseGiftCard.js's PURCHASE_MESSAGE, because they are
// written for a customer, and the admin sentences are here, because they are
// written for somebody holding a catalogue screen. What both share is the reason
// CODE, which is a machine-readable contract and is defined here once — so
// purchaseGiftCard's PURCHASE_REASON entries are assigned from
// SELLABILITY_REASON rather than typed out again.
//
// Pure: no database, no next imports, so plain Node — which is what the test
// suite is — can load it. That matters here more than usual, because the thing
// worth testing is precisely the rule that has to be identical on both sides.
import { toPaise } from "./giftCardApplicability.js";

// Mirrors the reason codes purchaseGiftCard.js has always thrown, verbatim. The
// string IS the contract: app/api/store/gift-cards/purchase/v2/route.js maps
// these to HTTP statuses by matching on them, and gift_card_purchases' own
// status vocabulary expects a TEMPLATE_ARCHIVED failure to read as an archival
// rather than a bug.
export const SELLABILITY_REASON = Object.freeze({
  NOT_FOUND: "TEMPLATE_NOT_FOUND",
  ARCHIVED: "TEMPLATE_ARCHIVED",
  NOT_SELLABLE: "TEMPLATE_NOT_SELLABLE",
  NOT_ON_SALE: "TEMPLATE_NOT_ON_SALE",
  NO_VALUE: "TEMPLATE_NO_VALUE",
  VALUE_MISMATCH: "TEMPLATE_VALUE_MISMATCH",
});

// For an admin, who is the person deciding what can be sold and needs to know
// which column to fix. Deliberately not the shopper sentences.
export const SELLABILITY_MESSAGE = Object.freeze({
  TEMPLATE_NOT_FOUND: "This template does not exist.",
  TEMPLATE_ARCHIVED: "Archived. This is a retired card, not a product that can be sold.",
  TEMPLATE_NOT_SELLABLE:
    "Not sellable. Set status to ACTIVE and is_active to true to put it on sale.",
  TEMPLATE_NOT_ON_SALE: "Outside its sale window. Check starts_at and ends_at.",
  TEMPLATE_NO_VALUE:
    "This template has no face value, so there is nothing to sell. Set faceValue to a positive amount.",
  TEMPLATE_VALUE_MISMATCH:
    "faceValue and initialAmount disagree, so a code would be issued for a different amount than the one advertised. Set faceValue; the update writes both columns.",
});

/**
 * May this template be sold right now?
 *
 * Returns { sellable, reason, faceValuePaise }, where `reason` is null exactly
 * when `sellable` is true. `faceValuePaise` is the advertised value in integer
 * paise on success and 0 otherwise, which is what the purchase path charges from.
 *
 * Why five separate rules and not a status check: `status` alone is not enough,
 * and each of the others has caught something.
 *
 *   * status = 'ACTIVE' stops a RETIRED template from being sold. The ARCHIVED
 *     case is not hypothetical: migration 020 exists because the seven rows
 *     gift_cards held were issued cards, five of which migration 017 had already
 *     moved into gift_card_codes, and something re-activated them afterwards so
 *     they read as live products again.
 *   * is_active is the sell gate, separate from status so a card can be paused
 *     without losing the DRAFT/ACTIVE/ARCHIVED history status records.
 *   * starts_at / ends_at are the window the template may be SOLD in, as opposed
 *     to how long an issued code lasts. Nothing else in the system reads them.
 *   * a positive face_value, because that is what a buyer is promised. A
 *     template with none is not a cheap card, it is a broken one.
 *   * face_value === initial_amount, because GiftCardCode.issueInTx stamps a
 *     code's value from `initial_amount` and not from `face_value`. That column
 *     is legacy and the behaviour is fixed and tested, so the two have to agree
 *     or a buyer is quoted one number and handed a card worth another. The POST
 *     route writes both from a single faceValue, so a correct template cannot
 *     disagree with itself; this is the check that makes an edited one fail
 *     loudly instead of quietly under-delivering.
 *
 * A template that fails the last one is refused as TEMPLATE_VALUE_MISMATCH
 * rather than silently corrected. Quietly correcting would mean an admin's edit
 * to face_value also rewrote initial_amount behind their back — and the PATCH
 * route refuses that outright, so the two would disagree about the same row.
 */
export function sellabilityOf(template, now = new Date()) {
  const denied = (reason) => ({ sellable: false, reason, faceValuePaise: 0 });

  if (!template) return denied(SELLABILITY_REASON.NOT_FOUND);
  if (template.status === "ARCHIVED") return denied(SELLABILITY_REASON.ARCHIVED);
  if (template.status !== "ACTIVE" || template.is_active !== true) {
    return denied(SELLABILITY_REASON.NOT_SELLABLE);
  }

  const at = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const nowMs = Number.isFinite(at) ? at : Date.now();
  if (template.starts_at && new Date(template.starts_at).getTime() > nowMs) {
    return denied(SELLABILITY_REASON.NOT_ON_SALE);
  }
  if (template.ends_at && new Date(template.ends_at).getTime() <= nowMs) {
    return denied(SELLABILITY_REASON.NOT_ON_SALE);
  }

  const facePaise = toPaise(template.face_value);
  if (!(facePaise > 0)) return denied(SELLABILITY_REASON.NO_VALUE);
  if (toPaise(template.initial_amount) !== facePaise) {
    return denied(SELLABILITY_REASON.VALUE_MISMATCH);
  }

  return { sellable: true, reason: null, faceValuePaise: facePaise };
}
