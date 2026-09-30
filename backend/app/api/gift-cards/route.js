import { corsHeaders } from "@/lib/cors";
import { parsePagination } from "@/lib/pagination";
import { GiftCard } from "@/lib/models/giftCard";
import { sendGiftCardEmail } from "@/lib/mail";
import { authorize } from "@/lib/authorization";
import { KEY_PERMISSIONS, GIFT_CARD_STATUSES } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.GIFT_CARDS_VIEW);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";
    const { page, limit } = parsePagination(searchParams);

    const { rows: giftCards, pagination } = await GiftCard.list({ search, status, page, limit });

    return Response.json(
      { success: true, giftCards, pagination },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("List gift cards error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}

export async function POST(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.GIFT_CARDS_CREATE);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { code, amount, recipientEmail, expiresAt, status } = body;

    if (!code || typeof code !== "string" || !code.trim()) {
      return Response.json(
        { success: false, message: "A gift card code is required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!(Number(amount) > 0)) {
      return Response.json(
        { success: false, message: "Amount must be greater than zero" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (status && !GIFT_CARD_STATUSES.includes(status)) {
      return Response.json(
        { success: false, message: "Invalid status" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (recipientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(recipientEmail).trim())) {
      return Response.json(
        { success: false, message: "Recipient email is not valid" },
        { status: 400, headers: corsHeaders() }
      );
    }

    try {
      const giftCard = await GiftCard.create({
        code,
        amount: Number(amount),
        recipientEmail,
        expiresAt: expiresAt || null,
        status: status || "ACTIVE",
      });

      // Recipient email, when given: the card details go out by mail.
      // Best effort — a failed send never fails the issue itself.
      let emailSent = false;
      if (giftCard.recipient_email) {
        const sent = await sendGiftCardEmail(giftCard.recipient_email, {
          code: giftCard.code,
          amount: `₹${Number(giftCard.initial_amount).toLocaleString("en-IN")}`,
          expiresAt: giftCard.expires_at
            ? new Date(giftCard.expires_at).toLocaleDateString("en-IN", { dateStyle: "medium" })
            : "No expiry",
        });
        emailSent = sent.success;
      }

      return Response.json(
        {
          success: true,
          message: emailSent
            ? "Gift card issued and emailed successfully"
            : giftCard.recipient_email
              ? "Gift card issued successfully. Email could not be sent — code logged to server console."
              : "Gift card issued successfully",
          giftCard,
          emailSent,
        },
        { status: 201, headers: corsHeaders() }
      );
    } catch (error) {
      if (String(error?.code) === "23505") {
        return Response.json(
          { success: false, message: "A gift card with this code already exists" },
          { status: 409, headers: corsHeaders() }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error("Create gift card error:", error);
    return Response.json(
      { success: false, message: error?.message || "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
