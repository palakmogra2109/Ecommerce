import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { Order } from "@/lib/models/order";
import { Product } from "@/lib/models/product";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

// Never trust client-side prices: always re-fetch product price + stock from
// the DB and compute subtotal/server-truth numbers here.
export async function POST(request) {
  let client;
  try {
    const body = await request.json();

    const customerName = (body.customerName || "").trim();
    const customerEmail = (body.customerEmail || "").trim().toLowerCase();
    const customerMobile = (body.customerMobile || "").trim();
    const shippingAddress =
      typeof body.shippingAddress === "object" && body.shippingAddress
        ? body.shippingAddress
        : {};
    const paymentMethod = ["cod", "stripe_sandbox", "paypal_sandbox"].includes(
      body.paymentMethod
    )
      ? body.paymentMethod
      : "cod";

    const items = Array.isArray(body.items) ? body.items : [];

    if (!customerName || !customerEmail) {
      return Response.json(
        { success: false, message: "Name and email are required" },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (items.length === 0) {
      return Response.json(
        { success: false, message: "Your cart is empty" },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Fetch fresh product truth for every cart line.
    const productUuids = items.map((i) => i.product_uuid);
    const productResult = await pool.query(
      `
      SELECT uuid, name, sku, price, discount_price, stock,
             status, inventory_mode
      FROM products
      WHERE uuid = ANY($1::uuid[])
      `,
      [productUuids]
    );

    const byUuid = new Map(
      productResult.rows.map((p) => [
        p.uuid,
        { ...p, price: Number(p.price) || 0, stock: Number(p.stock) || 0 },
      ])
    );

    client = await pool.connect();
    await client.query("BEGIN");

    const insertedItems = [];
    let subtotal = 0;
    let stockUpdates = 0;

    for (const item of items) {
      const product = byUuid.get(item.product_uuid);

      if (!product || product.status !== "ACTIVE") {
        await client.query("ROLLBACK");
        return Response.json(
          { success: false, message: "A product in your cart is no longer available" },
          { status: 400, headers: corsHeaders() }
        );
      }

      const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
      const unitPrice =
        product.discount_price !== null && product.discount_price > 0
          ? Number(product.discount_price)
          : product.price;

      if (product.stock < quantity) {
        await client.query("ROLLBACK");
        return Response.json(
          {
            success: false,
            message: `Only ${product.stock} of "${product.name}" left in stock`,
            product: product.uuid,
          },
          { status: 400, headers: corsHeaders() }
        );
      }

      const lineSubtotal = unitPrice * quantity;
      subtotal += lineSubtotal;

      insertedItems.push({
        product_uuid: product.uuid,
        product_name: product.name,
        sku: product.sku,
        variant: null,
        price: unitPrice,
        quantity,
        subtotal: lineSubtotal,
      });

      if (product.inventory_mode === "SIMPLE") {
        const dec = await client.query(
          `UPDATE products SET stock = stock - $1, updated_at = now()
           WHERE uuid = $2 AND stock >= $1`,
          [quantity, product.uuid]
        );
        stockUpdates += dec.rowCount;
      }
    }

    // Create order header (payment_pending COD; sandbox gateways marked PENDING
    // too — a real gateway would webhook it to PAID).
    const order = await Order.create({
      customerId: body.customer_id || null,
      customerName,
      customerEmail,
      customerMobile,
      shippingAddress,
      subtotal,
      discount: 0,
      total: subtotal,
      couponId: null,
      couponCode: null,
      paymentMethod,
      paymentStatus: paymentMethod === "cod" ? "PENDING" : "PENDING",
    });

    for (const line of insertedItems) {
      await client.query(
        `
        INSERT INTO order_items
          (order_id, product_uuid, product_name, sku, variant, price, quantity, subtotal)
        VALUES ((SELECT id FROM orders WHERE uuid = $1), $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          order.uuid,
          line.product_uuid,
          line.product_name,
          line.sku,
          line.variant,
          line.price,
          line.quantity,
          line.subtotal,
        ]
      );
    }

    await client.query("COMMIT");
    client.release();

    const detail = await Order.getDetailByUuid(order.uuid);

    return Response.json(
      {
        success: true,
        message:
          paymentMethod === "cod"
            ? "Order placed — pay cash on delivery"
            : "Order placed (sandbox gateway — no real charge)",
        order: detail,
        trackingUrl: `/orders/${order.order_number}`,
      },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
        client.release();
      } catch (_) {}
    }
    console.error("Store checkout error:", error);
    return Response.json(
      { success: false, message: "Checkout failed. Please try again." },
      { status: 500, headers: corsHeaders() }
    );
  }
}
