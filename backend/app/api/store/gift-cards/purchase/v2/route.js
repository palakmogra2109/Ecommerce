import { cookies, headers } from "next/headers";
import { corsHeaders } from "@/lib/cors";
import { authenticate } from "@/lib/authorization";
import { listPurchasesForCustomer, purchaseGiftCard, PurchaseError } from "@/lib/services/purchaseGiftCard";

export const runtime = "nodejs";

// This is the v2 purchase route. It lives on a NEW path so the legacy
// app/api/store/gift-cards/purchase/route.js keeps serving the storefront that
// still calls it — that route creates a DRAFT `gift_cards` row per card and is
// untouched by anything here. The difference that matters: this one issues
// `gift_card_codes`, the hashes the claim service redeems into a wallet, and
// writes a delivery row per code for the worker to send.
//
// PurchaseError.code -> HTTP status. This table is the only place a refusal
// becomes a status number, and every row is a condition the buyer caused or the
// catalogue caused, so none of them is a 500: a server error would tell a shopper
// to retry something that cannot succeed, and would page somebody for their own
// gift card.
//
//   PAYMENT_DECLINED    402  the honest answer to a declined card — the request
//                           was well formed and the gateway refused it
//   TEMPLATE_NOT_FOUND  404  no such template
//   INVALID_QUANTITY /
//   QUANTITY_LIMIT /
//   PURCHASE_TOO_LARGE /
//   RECIPIENT_* /
//   UNKNOWN_PROVIDER    400  the request, not the system
//   not sellable        409  the card exists and cannot be bought right now
//   PAYMENT_MISMATCH    502  the gateway settled for something else. A gateway
//                           fault rather than a buyer's: 402 would say "your card
//                           was refused", which is not what happened
//   ISSUANCE_FAILED     500  paid, and nothing issued. The one case here that IS
//                           a fault in here, and the only honest status for it
const STATUS_BY_CODE = Object.freeze({
  TEMPLATE_NOT_FOUND: 404,
  TEMPLATE_ARCHIVED: 409,
  TEMPLATE_NOT_SELLABLE: 409,
  TEMPLATE_NOT_ON_SALE: 409,
  TEMPLATE_NO_VALUE: 409,
  TEMPLATE_VALUE_MISMATCH: 409,
  INVALID_QUANTITY: 400,
  QUANTITY_LIMIT: 400,
  PURCHASE_TOO_LARGE: 400,
  RECIPIENT_REQUIRED: 400,
  RECIPIENT_INVALID: 400,
  UNKNOWN_PAYMENT_PROVIDER: 400,
  PAYMENT_DECLINED: 402,
  PAYMENT_MISMATCH: 502,
  ISSUANCE_FAILED: 500,
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Who is asking, if anyone.
//
// A gift card is the classic gift, so a purchase must work without an account —
// the code goes to an address instead. The distinction that matters is between
// NO credentials and BAD credentials: a guest is a legitimate buyer, while a
// request carrying an expired or forged token is not, and silently treating the
// second as the first would let a broken session turn into an unattributed
// purchase. So a presented token must verify, and only its absence means guest.
async function caller() {
  const [headerStore, cookieStore] = await Promise.all([headers(), cookies()]);
  const bearer = headerStore.get("authorization")?.replace(/^Bearer\s+/i, "")?.trim();
  const presented = Boolean(bearer || cookieStore.get("token")?.value);
  if (!presented) return { ok: true, user: null, customerId: null };
  const auth = await authenticate();
  if (!auth.ok) return auth;
  return { ok: true, user: auth.user, customerId: auth.user.customerId ?? null };
}

// The buyer's own gift-card history: last4 per code, never the plaintext.
//
// Read-only in the strict sense — no lock, no wallet, no bucket, no timestamp
// touched. A guest has no history to read, so this needs an account: with no
// purchaser_id on the purchase there is nothing to match a caller against, and
// answering with somebody else's purchases because their address was guessed
// would be worse than answering with none.
export async function GET() {
  try {
    const auth = await caller();
    if (!auth.ok) return auth.response;
    if (!auth.customerId) {
      return Response.json(
        { success: false, code: "NOT_SIGNED_IN", message: "Sign in to see your gift card purchases." },
        { status: 401, headers: corsHeaders() }
      );
    }

    const purchases = await listPurchasesForCustomer(auth.customerId);
    return Response.json(
      { success: true, purchases },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("List gift card purchases error:", error);
    return Response.json(
      { success: false, message: "Could not load your gift card purchases." },
      { status: 500, headers: corsHeaders() }
    );
  }
}

// Buys `quantity` gift cards and returns the codes — once, and only here.
//
// The response below is the ONLY place a plaintext code exists outside the
// buyer's hands and the delivery email. It is never written to a log, never put
// in an error, and never stored: gift_card_codes holds the hash and the last four
// characters, which is why the GET above can only ever show last4.
export async function POST(request) {
  try {
    const auth = await caller();
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));

    // A missing templateId is a malformed request rather than a wrong card, so it
    // is answered before the service is asked — which keeps 400 for "you sent
    // nothing" and TEMPLATE_NOT_FOUND for "there is no such card" meaning
    // different things.
    if (body.templateId == null || String(body.templateId).trim() === "") {
      return Response.json(
        { success: false, code: "INVALID_TEMPLATE", message: "Choose a gift card to buy." },
        { status: 400, headers: corsHeaders() }
      );
    }

    try {
      const result = await purchaseGiftCard({
        templateId: body.templateId,
        quantity: body.quantity,
        // From the session, never from the body: nobody may buy a gift card into
        // somebody else's wallet by naming their id.
        purchaserId: auth.customerId,
        recipientEmail: body.recipientEmail,
        recipientName: body.recipientName,
        giftMessage: body.giftMessage,
        // Passed through unfiltered so an unregistered name is refused by the
        // service (400) rather than quietly becoming a sandbox charge. The
        // registry holds only `sandbox` today; a real gateway's id arrives here.
        providerName: body.providerName ?? "sandbox",
      });

      // The audit line: what was bought, for how much, by whom. Never a code —
      // this transaction exists to produce one, and a log is exactly the wrong
      // place for it. Same rule as the claim route, for the same reason.
      console.info("Gift card purchased", {
        purchaseId: result.purchase.id,
        purchaseUuid: result.purchase.uuid,
        templateId: result.purchase.template_id,
        quantity: result.quantity,
        total: result.totalAmount,
        currency: result.currency,
        paymentStatus: result.purchase.payment_status,
        // Deliberately no last4 either: four characters of an eight-character
        // code are a million candidates, which is a short list for anyone holding
        // both this log and a database dump. The purchase id finds the codes.
        guest: !auth.customerId,
        deliveries: result.delivery.length,
      });

      return Response.json(
        {
          success: true,
          message: `Your gift card${result.quantity === 1 ? " is" : "s are"} ready.`,
          purchase: {
            id: result.purchase.id,
            uuid: result.purchase.uuid,
            templateId: result.purchase.template_id,
            quantity: result.quantity,
            unitFaceValue: result.purchase.unit_face_value,
            unitSellingPrice: result.purchase.unit_selling_price,
            totalAmount: result.totalAmount,
            currency: result.currency,
            status: result.purchase.status,
            paymentStatus: result.purchase.payment_status,
            recipientEmail: result.purchase.recipient_email,
            createdAt: result.purchase.created_at,
          },
          // The plaintext, one time. Show them, then let them go: the database has
          // the hash and nothing else, so this response cannot be reproduced.
          codes: result.codes.map((code) => ({
            code: code.code,
            codeLast4: code.codeLast4,
            faceValue: code.faceValue,
            currency: code.currency,
            expiresAt: code.expiresAt,
          })),
          // SKIPPED means there was no address to send to, which is why the buyer
          // is told: the codes above are the only copy.
          delivery: result.delivery.map((row) => ({
            codeLast4: result.codes.find((code) => code.id === row.codeId)?.codeLast4 || null,
            channel: row.channel,
            status: row.status,
          })),
        },
        { status: 201, headers: corsHeaders() }
      );
    } catch (error) {
      // Anything that is not a PurchaseError is a fault in here, not in the
      // request, so it is left to the 500 below rather than dressed up as a
      // refusal. No code is in scope here: a purchase that threw never returned
      // one, and the service logs nothing.
      if (!(error instanceof PurchaseError)) throw error;

      const status = STATUS_BY_CODE[error.code] || 409;
      console.info("Gift card purchase refused", {
        code: error.code,
        status,
        templateId: body.templateId,
        customerId: auth.customerId,
        guest: !auth.customerId,
      });

      return Response.json(
        { success: false, code: error.code, message: error.message },
        { status, headers: corsHeaders() }
      );
    }
  } catch (error) {
    console.error("Gift card purchase error:", error);
    return Response.json(
      { success: false, message: "Could not complete this gift card purchase." },
      { status: 500, headers: corsHeaders() }
    );
  }
}