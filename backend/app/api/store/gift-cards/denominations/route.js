import { corsHeaders } from "@/lib/cors";
import { GiftDenomination } from "@/lib/models/giftDenomination";

export const runtime = "nodejs";

// Public: the E-Cards shelf is browsable before login, like a product list.
export async function GET() {
  try {
    const denominations = await GiftDenomination.list({ activeOnly: true });

    return Response.json(
      { success: true, denominations },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Store denominations error:", error);
    return Response.json(
      { success: false, message: "Could not load gift cards." },
      { status: 500, headers: corsHeaders() }
    );
  }
}
