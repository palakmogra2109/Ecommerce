import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { authenticate } from "@/lib/authorization";
import { GiftCard } from "@/lib/models/giftCard";
import { sendGiftCardEmail } from "@/lib/mail";
import { createSchedule, sendDueGiftCards } from "@/lib/giftCardDelivery";
import { GiftDenomination } from "@/lib/models/giftDenomination";
import { recordGiftCardPurchase } from "@/lib/giftCardOrders";
import { round2 } from "@/lib/giftCardRules";

export const runtime = "nodejs";

// Customer gift-card purchase bounds (spec: admin-configurable in a fuller
// settings build; constants here until then). Enforced server-side as well as
// in the form: a client that posts a smaller amount must not be believed.
const PURCHASE_MIN_AMOUNT = 100;
const PURCHASE_MAX_AMOUNT = 50000;
const PURCHASE_MAX_QUANTITY = 20;
const PURCHASE_MAX_TOTAL = PURCHASE_MAX_AMOUNT * PURCHASE_MAX_QUANTITY;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Buys a gift card for someone else. The card is created DRAFT and is only
// activated after the (sandbox) payment succeeds — never before, so a failed
// or abandoned payment can never leave a usable card behind.
export async function POST(request) {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const recipientEmail = String(body.recipientEmail || "").trim().toLowerCase();
    const recipientName = String(body.recipientName || "").trim().slice(0, 120);
    const recipientPhone = String(body.recipientPhone || "").replace(/\D/g, "").slice(-15);
    const message = String(body.message || "").trim().slice(0, 300);
    const paymentMethod = ["stripe_sandbox", "paypal_sandbox"].includes(body.paymentMethod)
      ? body.paymentMethod
      : null;

    // How many cards this purchase issues. Each is a separate card with its own
    // code, so they stay independently spendable and independently refundable.
    const quantity = Math.max(1, Math.min(PURCHASE_MAX_QUANTITY, parseInt(body.quantity, 10) || 1));

    // A catalogue denomination fixes both the face value and what the buyer
    // pays. Without one, the shopper typed a custom amount and pays it in full.
    let denomination = null;
    if (body.denominationUuid) {
      denomination = await GiftDenomination.findByUuid(String(body.denominationUuid).trim());
      if (!denomination || !denomination.is_active) {
        return Response.json(
          { success: false, message: "That gift card option is no longer available." },
          { status: 400, headers: corsHeaders() }
        );
      }
    }

    // The recipient's balance is the face value. selling_price is what the
    // buyer pays, which is lower when the denomination is on promotion.
    const amount = denomination ? denomination.face_value : Number(body.amount) || 0;
    const sellingPrice = denomination ? denomination.selling_price : amount;

    // "now" issues the card immediately; a future date queues the intent and
    // the card itself does not exist until that moment.
    let scheduledFor = null;
    if (body.sendLater) {
      const when = new Date(body.scheduledFor);
      if (Number.isNaN(when.getTime())) {
        return Response.json(
          { success: false, message: "Pick a valid send date." },
          { status: 400, headers: corsHeaders() }
        );
      }
      // Same-day is allowed (so is "in ten minutes"); only the past is not.
      if (when.getTime() < Date.now() - 60_000) {
        return Response.json(
          { success: false, message: "Choose a date that has not passed." },
          { status: 400, headers: corsHeaders() }
        );
      }
      scheduledFor = when;
    }

    if (!(amount >= PURCHASE_MIN_AMOUNT && amount <= PURCHASE_MAX_AMOUNT)) {
      return Response.json(
        { success: false, message: `Amount must be between ₹${PURCHASE_MIN_AMOUNT} and ₹${PURCHASE_MAX_AMOUNT}.` },
        { status: 400, headers: corsHeaders() }
      );
    }
    // A batch can otherwise multiply past any sane ceiling.
    if (round2(sellingPrice * quantity) > PURCHASE_MAX_TOTAL) {
      return Response.json(
        {
          success: false,
          message: `That is too large a purchase. The maximum per order is ₹${PURCHASE_MAX_TOTAL.toLocaleString("en-IN")}.`,
        },
        { status: 400, headers: corsHeaders() }
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return Response.json(
        { success: false, message: "A valid recipient email is required." },
        { status: 400, headers: corsHeaders() }
      );
    }
    if (!paymentMethod) {
      return Response.json(
        { success: false, message: "Gift cards need an online payment method." },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Scheduled: record the intent and stop. No card, no code, nothing to
    // spend until the delivery worker runs.
    if (scheduledFor) {
      const scheduled = await createSchedule({
        amount,
        sellingPrice,
        denominationUuid: denomination?.uuid || null,
        validForDays: denomination?.valid_for_days || null,
        currency: "INR",
        recipientEmail,
        recipientName: recipientName || null,
        giftMessage: message || null,
        scheduledFor,
      });

      // Anything already due goes out now rather than waiting for the next
      // page load to notice.
      await sendDueGiftCards();

      return Response.json(
        {
          success: true,
          message: `Your gift card will be emailed to ${recipientEmail} on ${scheduledFor.toLocaleDateString("en-IN", { dateStyle: "medium" })}.`,
          scheduled: {
            uuid: scheduled.uuid,
            amount,
            recipientEmail,
            recipientName,
            scheduledFor: scheduled.scheduled_for,
          },
        },
        { status: 201, headers: corsHeaders() }
      );
    }

    // The catalogue's validity window becomes the card's expiry. A custom
    // amount has no window and never expires.
    const expiresAt = denomination?.valid_for_days
      ? new Date(Date.now() + denomination.valid_for_days * 86400000).toISOString()
      : null;

    const cardLabel = String(body.label || "Gift Card").trim().slice(0, 60);
    const cardImage = body.imageUrl ? String(body.imageUrl).trim().slice(0, 500) : null;

    const cards = [];
    for (let i = 0; i < quantity; i++) {
      cards.push(
        await GiftCard.create({
          amount,
          label: cardLabel,
          imageUrl: cardImage,
          sellingPrice,
          denominationUuid: denomination?.uuid || null,
          expiresAt,
          currency: "INR",
          source: "PURCHASED",
          recipientEmail,
          status: "DRAFT",
          ledgerType: "PURCHASED",
          createdBy: auth.user.id,
        })
      );
    }
    const card = cards[0];

    // Sandbox gateways settle instantly; a real gateway would activate on
    // its webhook instead. COD can never complete a digital-goods purchase.
    // Every card is activated in one transaction: a half-settled batch would
    // leave the shopper short of the cards they paid for.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const uuids = cards.map((c) => c.uuid);
      const locked = await client.query(
        `SELECT id, uuid, balance FROM gift_cards WHERE uuid = ANY($1::uuid[]) FOR UPDATE`,
        [uuids]
      );
      if (locked.rows.length !== cards.length) {
        throw new Error("A card vanished mid-purchase");
      }
      for (const row of locked.rows) {
        await client.query(
          `UPDATE gift_cards SET status = 'ACTIVE', activated_at = now(), updated_at = now() WHERE id = $1`,
          [row.id]
        );
        await client.query(
          `UPDATE gift_card_transactions
           SET metadata = $2, reason = 'Customer purchase'
           WHERE gift_card_id = $1 AND type = 'PURCHASED'`,
          [
            row.id,
            JSON.stringify({
              recipientName,
              recipientPhone,
              message,
              paymentMethod,
              buyer: auth.user.email,
              quantity,
            }),
          ]
        );
        await client.query(
          `INSERT INTO gift_card_transactions
             (gift_card_id, type, amount, balance_before, balance_after, performed_by, reason)
           VALUES ($1, 'ACTIVATED', $2, $2, $2, $3, 'Payment settled')`,
          [row.id, amount, auth.user.email]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    // One email carrying every code, so the recipient has all of them in a
    // single place rather than N separate messages.
    const sent = await sendGiftCardEmail(recipientEmail, {
      code: cards.length === 1 ? cards[0].code : cards.map((c) => c.code).join("  "),
      amount: `₹${Number(amount).toLocaleString("en-IN")}`,
      expiresAt: "No expiry",
      recipientName: recipientName || "there",
      giftMessage: message,
      quantity: cards.length,
    });

    // Record the sale. Without this the money taken is invisible to orders and
    // reports, because a gift card purchase is not a product order.
    // The card is already issued and emailed at this point, so a failure to
    // book the sale must not tell the shopper their purchase failed. It is
    // logged loudly instead: the money is real and needs to be recoverable.
    let order = null;
    try {
      // One order for the batch: the shopper paid once, so it is one sale.
      order = await recordGiftCardPurchase({
        customerId: auth.user.customerId ?? null,
        customerName: auth.user.name || auth.user.email,
        customerEmail: auth.user.email,
        cardUuid: card.uuid,
        cardUuids: cards.map((c) => c.uuid),
        label: cardLabel,
        faceValue: round2(amount * quantity),
        paidAmount: round2(sellingPrice * quantity),
        quantity,
      });
    } catch (orderError) {
      console.error("Gift card issued but the sale could not be booked:", orderError, {
        cardUuid: card.uuid,
        amount,
        sellingPrice,
        customerEmail,
      });
    }

    return Response.json(
      {
        success: true,
        message:
          cards.length === 1
            ? sent.success
              ? "Gift card purchased and emailed to the recipient."
              : "Gift card purchased. Email could not be sent — the code below is the only copy."
            : sent.success
              ? `${cards.length} gift cards purchased and emailed to the recipient.`
              : `${cards.length} gift cards purchased. Email could not be sent — the codes below are the only copies.`,
        giftCard: {
          // For a single card this is the code; for a batch it is every one.
          code: cards.length === 1 ? cards[0].code : cards.map((c) => c.code).join("  "),
          codes: cards.map((c) => c.code),
          quantity: cards.length,
          amount,
          sellingPrice,
          faceValue: amount,
          totalPaid: round2(sellingPrice * quantity),
          discounted: sellingPrice < amount,
          expiresAt,
          recipientEmail,
          recipientName,
          message,
        },
        order: order ? { orderNumber: order.order_number, uuid: order.uuid, total: order.total } : null,
        emailSent: sent.success,
      },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Purchase gift card error:", error);
    return Response.json(
      { success: false, message: error?.message || "Could not complete the purchase." },
      { status: 500, headers: corsHeaders() }
    );
  }
}
