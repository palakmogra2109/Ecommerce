import { corsHeaders } from "@/lib/cors";
import { GiftCard } from "@/lib/models/giftCard";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  try {
    const auth = await authorize(KEY_PERMISSIONS.GIFT_CARDS_VIEW);
    if (!auth.ok) return auth.response;

    const stats = await GiftCard.stats();
    return Response.json({ success: true, stats }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    console.error("Gift card stats error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
