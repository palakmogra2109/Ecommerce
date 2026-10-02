import { corsHeaders } from "@/lib/cors";
import { authenticate } from "@/lib/authorization";
import { GiftCard } from "@/lib/models/giftCard";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Cards belonging to the logged-in shopper: either explicitly assigned via
// customer_id, or issued to their email as the recipient. Plain authenticate():
// shoppers hold no branch roles.
export async function GET() {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;

    const email = (auth.user.email || "").toLowerCase().trim();
    const customerId = auth.user.customerId ?? null;

    // Hash-stored cards have no recoverable code, so the wallet shows the
    // masked form only. The full code reaches the shopper in their email.
    const giftCards = await GiftCard.listForCustomer({ email, customerId });

    return Response.json(
      { success: true, giftCards },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Store gift cards error:", error);
    return Response.json(
      { success: false, message: "Could not load gift cards." },
      { status: 500, headers: corsHeaders() }
    );
  }
}
