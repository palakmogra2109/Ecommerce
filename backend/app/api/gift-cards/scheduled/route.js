import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";
import { listScheduled, sendDueGiftCards } from "@/lib/giftCardDelivery";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// What is queued for later and what has gone out. Scheduled cards are the
// only way a gift card exists without a code yet.
export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.GIFT_CARDS_VIEW);
    if (!auth.ok) return auth.response;

    const status = new URL(request.url).searchParams.get("status") || "";
    const scheduled = await listScheduled({ status, limit: 200 });

    return Response.json(
      {
        success: true,
        scheduled,
        counts: scheduled.reduce((acc, s) => {
          acc[s.status] = (acc[s.status] || 0) + 1;
          return acc;
        }, {}),
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("List scheduled gift cards error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}

// Run the delivery worker by hand. There is no cron yet, so until one is wired
// this is what makes a scheduled card actually go out.
export async function POST(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.GIFT_CARDS_UPDATE);
    if (!auth.ok) return auth.response;

    const result = await sendDueGiftCards();

    return Response.json(
      {
        success: true,
        message:
          result.processed === 0
            ? "No gift cards are due for delivery."
            : `${result.processed} due: ${result.emailed} emailed, ${result.undelivered} issued but the email failed.`,
        result,
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Run gift card delivery error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
