import pool from "./db";
import { round2 } from "./giftCardRules";

const ORDER_STATUS = "CONFIRMED";
const PAYMENT_STATUS = "PAID";

// Gift card purchases are not product orders, but the money is real and has to
// be visible in the order list, revenue reports and GST figures. A synthetic
// order row is the least surprising place for it, and it keeps one timeline for
// "everything this customer bought".
export async function recordGiftCardPurchase({
  customerId = null,
  customerName = "",
  customerEmail = "",
  cardUuid,
  // The whole batch, so one sale can be traced back to every card it issued.
  cardUuids = null,
  label = "Gift card",
  quantity = 1,
  faceValue,
  paidAmount,
} = {}) {
  const paid = round2(paidAmount ?? faceValue);
  const face = round2(faceValue);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: orderRows } = await client.query(
      `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM orders`
    );
    // The same MAX(id)+1 scheme Order.nextOrderNumber() uses, so gift card
    // sales and product orders share one unbroken number sequence. Deriving it
    // from the previous number's digits instead would break the moment any
    // other prefix (a test order, an import) entered the table.
    const nextId = Number(orderRows[0]?.next_id) || 1;
    const orderNumber = `ORD-${String(nextId).padStart(7, "0")}`;

    const order = (
      await client.query(
        `INSERT INTO orders
           (order_number, customer_id, customer_name, customer_email,
            subtotal, discount, total, payment_status, status, shipping_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb)
         RETURNING id, uuid, order_number, total`,
        [
          orderNumber,
          customerId,
          String(customerName || customerEmail || "Guest").slice(0, 120),
          String(customerEmail || "").toLowerCase(),
          // subtotal is the list price of what was sold, discount is the saving,
          // and total is what was actually paid. That keeps the invariant the
          // rest of the order code relies on: total = subtotal - discount.
          face,
          round2(face - paid),
          paid,
          PAYMENT_STATUS,
          ORDER_STATUS,
        ]
      )
    ).rows[0];

    // quantity x unit price, so a batch of 4 shows as 4 units rather than one
    // line with an unexplained total.
    const unitPaid = round2(paid / (quantity || 1));
    await client.query(
      `INSERT INTO order_items
         (order_id, product_name, sku, variant, price, quantity, subtotal)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        order.id,
        label,
        `GIFT-${cardUuid.slice(0, 8)}`,
        `${quantity} × face value ${round2(face / (quantity || 1))}`,
        unitPaid,
        quantity,
        paid,
      ]
    );

    await client.query("COMMIT");
    return order;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
