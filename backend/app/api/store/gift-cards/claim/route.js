import { corsHeaders } from "@/lib/cors";
import { authenticate } from "@/lib/authorization";
import { ClaimError, claimGiftCard } from "@/lib/services/claimGiftCard";
import {
  checkGuessAllowed,
  clearFailedGuesses,
  clientKey,
  recordFailedGuess,
} from "@/lib/giftCardGuards";

export const runtime = "nodejs";

// Per-process map of client -> failed code guesses. See lib/giftCardGuards.js.
const guessLog = new Map();

// ClaimError.code -> HTTP status. This table is the only place a refusal becomes
// a status number, and every row is a condition the customer caused, so none of
// them is ever a 500: a server error would tell the shopper to retry something
// that cannot succeed, and would page somebody for their own gift card.
//
//   NOT_FOUND  404  no such code
//   EXPIRED    410  the code named something real that is gone; 410 is the
//                  honest answer, and it tells a client not to retry
//   rest       409  the code exists and is in a state that cannot be claimed
const STATUS_BY_CODE = Object.freeze({
  NOT_FOUND: 404,
  REVOKED: 409,
  NOT_PAID: 409,
  NOT_YET_DELIVERED: 409,
  ALREADY_CLAIMED: 409,
  EXPIRED: 410,
  SCOPE_UNREADABLE: 409,
  NO_CUSTOMER: 409,
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Turns a code a shopper typed into money in their own wallet.
//
// Plain authenticate(), like every other store route: shoppers hold no branch
// roles, and a gift card is redeemed by whoever holds it rather than by whoever
// an admin says should have it.
export async function POST(request) {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const submitted = typeof body.code === "string" ? body.code : "";
    // A missing field is a malformed request rather than a wrong code, so it is
    // answered before anything is looked up — which keeps 400 for "you sent
    // nothing" and NOT_FOUND for "there is no such code" meaning different
    // things. Nothing submitted is ever put in the response or the log.
    if (!submitted.trim()) {
      return Response.json(
        { success: false, message: "A gift card code is required." },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Throttle before any lookup, so spraying guesses costs the attacker time
    // even when every guess misses. The codes are high entropy, so this is not
    // what makes them safe — it is what stops this being an unlimited oracle.
    const key = clientKey(request);
    const allowed = checkGuessAllowed(guessLog, key);
    if (!allowed.ok) {
      return Response.json(
        { success: false, message: "Too many gift card attempts. Please wait before trying again." },
        {
          status: 429,
          headers: { ...corsHeaders(), "Retry-After": String(allowed.retryAfterSec) },
        }
      );
    }

    try {
      const claimed = await claimGiftCard({ code: submitted, customerId: auth.user.customerId ?? null });

      // A code that worked is not a guess, so the budget is cleared: a shopper
      // who mistypes their own card twice must not be locked out by the attempt
      // before the right one.
      clearFailedGuesses(guessLog, key);
      // The audit line: who claimed, how much, and what their wallet now holds.
      // Never the code — this transaction turns that string into money, and a
      // log is exactly the wrong place for it.
      console.info("Gift card claimed", {
        customerId: auth.user.customerId ?? null,
        claimedValue: claimed.claimedValue,
        currency: claimed.currency,
        balanceAfter: claimed.balanceAfter,
      });

      return Response.json(
        {
          success: true,
          message: `₹${claimed.claimedValue.toLocaleString("en-IN")} has been added to your wallet. Your balance is now ₹${claimed.balanceAfter.toLocaleString("en-IN")}.`,
          claimedValue: claimed.claimedValue,
          currency: claimed.currency,
          balanceAfter: claimed.balanceAfter,
        },
        { status: 200, headers: corsHeaders() }
      );
    } catch (error) {
      // Anything that is not a ClaimError is a fault in here, not in the code
      // the customer typed, so it is left to the 500 below rather than being
      // dressed up as a refusal.
      if (!(error instanceof ClaimError)) throw error;

      const status = STATUS_BY_CODE[error.code] || 409;
      // Only a code that matched nothing counts as a guess. A code that exists
      // but is spent or expired is the customer's own card and they are entitled
      // to be told which, so charging it against the budget would punish people
      // for asking about money that is already theirs.
      if (error.code === "NOT_FOUND") {
        recordFailedGuess(guessLog, key);
      } else {
        clearFailedGuesses(guessLog, key);
      }
      console.info("Gift card claim refused", {
        customerId: auth.user.customerId ?? null,
        code: error.code,
        status,
      });

      // The message is the service's fixed sentence for that reason and the code
      // is the same stable string. Neither is derived from the submission, so
      // neither can confirm a guess.
      return Response.json(
        { success: false, code: error.code, message: error.message },
        { status, headers: corsHeaders() }
      );
    }
  } catch (error) {
    console.error("Gift card claim error:", error);
    return Response.json(
      { success: false, message: "Could not add this gift card to your wallet." },
      { status: 500, headers: corsHeaders() }
    );
  }
}