import pool from "./db";
import { GiftCard } from "./models/giftCard";
import { sendGiftCardEmail } from "./mail";

/**
 * Turns scheduled gift card intents into real, emailed cards.
 *
 * Nothing sensitive exists before this runs: a scheduled card is a row of
 * intent (who, how much, what they said, when), and the card plus its code are
 * created here, at the chosen moment. That is why scheduling works without
 * parking a plaintext code in the database for months.
 *
 * Ordering is deliberate, because a card write and an SMTP call cannot be one
 * atomic operation:
 *
 *  1. Create and activate the card, then email it. If the process dies between
 *     the two, the shopper paid and the card exists, so it can be re-sent by
 *     hand — nobody is left holding a card that silently never arrived.
 *  2. If the email fails, the card stays ACTIVE and the row is marked FAILED
 *     rather than reverted. Taking away money already paid for because a mail
 *     server blinked would be worse than a delayed email.
 *
 * Idempotent per row: a row is only picked up while PENDING, and the status
 * flips to SENT (or FAILED) in the same pass, so running this twice cannot
 * create a second card for one purchase.
 */
export async function sendDueGiftCards({ now = new Date(), limit = 100 } = {}) {
  const due = await pool.query(
    `SELECT * FROM gift_card_scheduled
     WHERE status = 'PENDING' AND scheduled_for <= $1
     ORDER BY scheduled_for ASC
     LIMIT $2`,
    [now, limit]
  );

  const results = { processed: 0, emailed: 0, undelivered: 0, cardUuids: [], failures: [] };

  for (const row of due.rows) {
    results.processed += 1;

    let card;
    try {
      card = await GiftCard.create({
        amount: Number(row.amount),
        currency: row.currency || "INR",
        source: "PURCHASED",
        recipientEmail: row.recipient_email,
        status: "DRAFT",
        ledgerType: "PURCHASED",
        sellingPrice: row.selling_price,
        denominationUuid: row.denomination_uuid,
      });
    } catch (error) {
      results.failures.push({ uuid: row.uuid, reason: `Could not create card: ${error.message}` });
      await markFailed(row.uuid, `Could not create card: ${error.message}`);
      continue;
    }

    try {
      await GiftCard.update(card.uuid, { status: "ACTIVE" });
    } catch (error) {
      results.failures.push({ uuid: row.uuid, reason: `Could not activate card: ${error.message}` });
      await markFailed(row.uuid, `Could not activate card: ${error.message}`);
      continue;
    }

    if (row.valid_for_days) {
      const expires = new Date(Date.now() + Number(row.valid_for_days) * 86400000);
      await GiftCard.update(card.uuid, { expiresAt: expires.toISOString() });
    }

    // The code is returned exactly once, by create(). This is the only moment
    // it is ever available for a scheduled card.
    const sent = await sendGiftCardEmail(row.recipient_email, {
      code: card.code,
      amount: `₹${Number(row.amount).toLocaleString("en-IN")}`,
      expiresAt: "No expiry",
      recipientName: row.recipient_name || "there",
      giftMessage: row.gift_message || "",
    });

    if (sent.success) {
      await pool.query(
        `UPDATE gift_card_scheduled
         SET status = 'SENT', card_uuid = $2, sent_at = now()
         WHERE uuid = $1`,
        [row.uuid, card.uuid]
      );
      results.emailed += 1;
    } else {
      // The card is live and paid for; only the email failed.
      await markFailed(row.uuid, "Card issued but the email could not be sent.");
      results.undelivered += 1;
      results.cardUuids.push(card.uuid);
    }
  }

  return results;
}

async function markFailed(uuid, reason) {
  await pool.query(
    `UPDATE gift_card_scheduled SET status = 'FAILED', failure_reason = $2 WHERE uuid = $1`,
    [uuid, String(reason).slice(0, 300)]
  );
}

// Admin list of what is queued and what has gone out.
export async function listScheduled({ status = "", limit = 50 } = {}) {
  const result = await pool.query(
    `SELECT uuid, amount, currency, recipient_email, recipient_name, gift_message,
            scheduled_for, status, card_uuid, failure_reason, created_at, sent_at
     FROM gift_card_scheduled
     ${status ? "WHERE status = $2" : ""}
     ORDER BY scheduled_for ASC
     LIMIT $1`,
    status ? [limit, status] : [limit]
  );
  return result.rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

export async function createSchedule({
  amount,
  sellingPrice = null,
  denominationUuid = null,
  validForDays = null,
  currency = "INR",
  recipientEmail,
  recipientName = null,
  giftMessage = null,
  scheduledFor,
} = {}) {
  const result = await pool.query(
    `INSERT INTO gift_card_scheduled
       (amount, selling_price, denomination_uuid, valid_for_days, currency,
        recipient_email, recipient_name, gift_message, scheduled_for, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING')
     RETURNING uuid, amount, recipient_email, recipient_name, scheduled_for, status, created_at`,
    [
      amount,
      sellingPrice,
      denominationUuid,
      validForDays,
      currency,
      recipientEmail,
      recipientName,
      giftMessage,
      scheduledFor,
    ]
  );
  return result.rows[0];
}
