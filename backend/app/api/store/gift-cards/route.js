import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { authenticate } from "@/lib/authorization";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Cards issued to the logged-in shopper's email. Plain authenticate():
// shoppers hold no branch roles.
export async function GET() {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;

    const email = (auth.user.email || "").toLowerCase().trim();
    const result = await pool.query(
      `SELECT uuid, code, initial_amount, balance, status, expires_at, created_at
       FROM gift_cards
       WHERE LOWER(recipient_email) = $1
       ORDER BY created_at DESC`,
      [email]
    );

    return Response.json(
      {
        success: true,
        giftCards: result.rows.map((r) => ({
          ...r,
          initial_amount: Number(r.initial_amount) || 0,
          balance: Number(r.balance) || 0,
        })),
      },
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
