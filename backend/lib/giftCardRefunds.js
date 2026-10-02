import pool from "./db";
import { GiftCardReservation } from "./models/giftCardReservation";
import { refundWalletSpendInTx } from "./giftCardSpend";

// Restores the gift-card portion of a cancelled/refunded order, and releases
// one coupon usage. Idempotent: a REFUND row for this (card, order) means it
// already ran, so double-cancel calls can never double-restore — even though
// the status update itself commits separately just above.
export async function reverseGiftRedemption(db, orderUuid, { reason = "Order cancelled", performedBy = null } = {}) {
  const runner = db || pool;
  const order = await runner.query(
    `SELECT id, order_number, gift_card_id, gift_amount FROM orders WHERE uuid = $1`,
    [orderUuid]
  );
  const o = order.rows[0];

  // Payment never completed for this order, so any live hold goes back to the
  // card regardless of whether a redemption was recorded.
  const released = await GiftCardReservation.releaseForOrder(orderUuid, {
    reason: `Order ${reason.toLowerCase()}`,
  });

  // The v2 half: whatever the checkout drew out of the customer's wallet for
  // this order goes back into the buckets it came out of. Run for every order,
  // not only the ones that used a legacy card — the two systems are spent side by
  // side and an order can have used either or both.
  const wallet = await refundWalletSpend(runner, orderUuid);

  if (!o || !o.gift_card_id || !(Number(o.gift_amount) > 0)) {
    return {
      restored: 0,
      walletRestored: wallet.restored,
      walletError: wallet.error,
      releasedReservations: released.length,
    };
  }

  const dup = await runner.query(
    `SELECT 1 FROM gift_card_transactions
     WHERE gift_card_id = $1 AND order_id = $2 AND type = 'REFUND' LIMIT 1`,
    [o.gift_card_id, o.id]
  );
  if (dup.rows.length > 0) {
    return {
      restored: 0,
      duplicate: true,
      walletRestored: wallet.restored,
      walletError: wallet.error,
      releasedReservations: released.length,
    };
  }

  const locked = await runner.query(
    `SELECT id, balance, status, expires_at FROM gift_cards WHERE id = $1 FOR UPDATE`,
    [o.gift_card_id]
  );
  const card = locked.rows[0];
  if (!card) {
    return {
      restored: 0,
      walletRestored: wallet.restored,
      walletError: wallet.error,
      releasedReservations: released.length,
    };
  }

  const amount = Number(o.gift_amount);
  const before = Number(card.balance) || 0;
  const after = before + amount;
  // A fully-used card comes back to life only if it has not also expired;
  // otherwise the restored balance stays unreachable, which is correct.
  const expired = Boolean(card.expires_at) && new Date(card.expires_at).getTime() < Date.now();
  // IS NOT TRUE, not "= false": a card with no expiry passes a NULL here, and
  // NULL = false would never revive it.
  await runner.query(
    `UPDATE gift_cards
     SET balance = $1,
         status = CASE
                    WHEN status = 'REDEEMED' AND $1::numeric > 0 AND $3 IS NOT TRUE THEN 'ACTIVE'
                    ELSE status
                  END,
         updated_at = now()
     WHERE id = $2`,
    [after, card.id, expired]
  );
  await runner.query(
    `INSERT INTO gift_card_transactions
       (gift_card_id, order_id, type, amount, balance_before, balance_after, performed_by, reason)
     VALUES ($1, $2, 'REFUND', $3, $4, $5, $6, $7)`,
    [card.id, o.id, amount, before, after, performedBy, `${reason} (${o.order_number})`]
  );
  return {
    restored: amount,
    walletRestored: wallet.restored,
    walletError: wallet.error,
    releasedReservations: released.length,
  };
}

// The wallet refund, in a transaction of its own.
//
// This function is called on a pool that has already committed the order's
// status change, so autocommit is not good enough: a bucket restored without its
// REFUND ledger row — or the reverse — is money that appears out of nowhere. It
// is opened here rather than at the call site because both call sites have
// already committed by the time they get here.
//
// A failure is ROLLED BACK and reported, never re-thrown and never swallowed. The
// order really has been cancelled by this point, so throwing would turn a
// completed cancel into a 500 the admin cannot retry (the cancel endpoints
// refuse a terminal order); swallowing it would leave a shopper's money out of
// their wallet with nothing said. So the caller gets the error to show, the log
// gets the stack, and the value is still exactly where the failed transaction
// left it. A later retry is safe by construction: refundInTx caps each bucket at
// what is still unrefunded, so the part a previous attempt did restore is never
// restored twice.
async function refundWalletSpend(runner, orderUuid) {
  const owned = typeof runner.connect === "function" ? await runner.connect() : null;
  const client = owned || runner;
  try {
    if (owned) await client.query("BEGIN");
    const restored = await refundWalletSpendInTx(client, {
      orderUuid,
      reference: "REFUND",
    });
    if (owned) await client.query("COMMIT");
    return { restored, error: null };
  } catch (error) {
    if (owned) await client.query("ROLLBACK").catch(() => {});
    console.error("Wallet refund failed for order", orderUuid, error);
    return { restored: 0, error: String(error?.message || error) };
  } finally {
    if (owned) owned.release();
  }
}

export async function releaseCouponUsage(db, orderUuid) {
  const runner = db || pool;
  const order = await runner.query(`SELECT coupon_code FROM orders WHERE uuid = $1`, [orderUuid]);
  if (!order.rows[0]?.coupon_code) return { released: false };
  await runner.query(
    `UPDATE coupons SET used_count = GREATEST(0, used_count - 1), updated_at = now() WHERE code = $1`,
    [order.rows[0].coupon_code]
  );
  return { released: true };
}
