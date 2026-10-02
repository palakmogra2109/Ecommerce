import { corsHeaders } from "@/lib/cors";
import { authenticate } from "@/lib/authorization";
import { previewClaim } from "@/lib/services/claimGiftCard";
import {
  checkGuessAllowed,
  clearFailedGuesses,
  clientKey,
  recordFailedGuess,
} from "@/lib/giftCardGuards";

export const runtime = "nodejs";

// Per-process map of client -> failed code guesses. Its own Map, not the claim
// route's: the two are separate rate limiters, so previewing twenty wrong codes
// does not eat the budget for the claim that follows and a shopper who mistypes
// their own card twice in the preview box can still redeem it immediately.
//
// It is a separate budget rather than a shared one on purpose. A shared budget
// would mean the preview — the endpoint with nothing to lose by being called in
// a loop — could lock a legitimate customer out of redeeming their own card.
// The rule below is the one that matters: a preview that finds nothing is
// counted as a guess, exactly as in the claim route. Without that, this endpoint
// would be an UNLIMITED oracle, which is the single thing the claim route's
// throttle exists to prevent.
const guessLog = new Map();

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// "What is this code worth?" — read-only, so the panel can say so BEFORE the
// shopper commits. Writes nothing: no lock, no bucket, no wallet, no ledger row
// and no timestamp touched, because previewClaim only reads (see its own
// comment). A preview that mutated state would make the panel a claim with the
// confirmation step removed.
//
// Every verdict comes back 200. This is a question that was answered, not an
// error the caller has to catch: `claimable` says whether the code can be used,
// `reason` says why not, and `message` is the service's own sentence for that
// reason. Only three statuses are not 200 — 400 for sending nothing at all,
// 429 for the throttle, and 500 for a fault in here. Mapping the verdicts onto
// 404/409/410 the way the claim route does would leak the same information in
// the status line as the body already gives, while making every caller handle
// an exception for an answer.
//
// Nothing submitted is ever put in the response or the log: this string is
// money at the claim endpoint, and NOT_FOUND says only that nothing was found,
// because a message revealing "that code exists but is revoked" would turn this
// endpoint into a code-guessing oracle with an unlimited budget.
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
        { success: false, claimable: false, reason: "THROTTLED", message: "Too many gift card attempts. Please wait before trying again." },
        {
          status: 429,
          headers: { ...corsHeaders(), "Retry-After": String(allowed.retryAfterSec) },
        }
      );
    }

    const verdict = await previewClaim({ code: submitted });

    // Only a code that matched nothing counts as a guess. A code that exists
    // but is spent or expired is the customer's own card and they are entitled
    // to be told which, so charging it against the budget would punish people
    // for asking about money that is already theirs.
    if (verdict.reason === "NOT_FOUND") {
      recordFailedGuess(guessLog, key);
    } else {
      clearFailedGuesses(guessLog, key);
    }

    // The reason and the sentence are the service's own, matched on rather than
    // reworded here, so the panel cannot promise something the claim will then
    // refuse. Neither is derived from the submission, so neither can confirm a
    // guess.
    console.info("Gift card preview", {
      customerId: auth.user.customerId ?? null,
      claimable: verdict.claimable,
      reason: verdict.reason,
    });

    return Response.json(
      {
        success: true,
        claimable: verdict.claimable,
        faceValue: verdict.faceValue,
        currency: verdict.currency,
        // The scope caption, and null for a code that cannot be claimed — see
        // previewClaim, which resolves it only on the claimable path.
        scopeLabel: verdict.scopeLabel,
        reason: verdict.reason,
        message: verdict.message,
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Gift card preview error:", error);
    return Response.json(
      { success: false, claimable: false, reason: null, message: "Could not check this gift card code." },
      { status: 500, headers: corsHeaders() }
    );
  }
}