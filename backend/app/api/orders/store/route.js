import pool from "@/lib/db";
import { corsHeaders } from "@/lib/cors";
import { Order } from "@/lib/models/order";
import { Branch } from "@/lib/models/branch";
import { ORDER_STATUS } from "@shared/constants";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

// Zomato-style store checkout.
//
// Never trust client-side prices: the customer selects a store first, then
// every cart line is priced from that store's branch_products row (falling
// back to the admin product price only when the store has no override).
// Stock is checked AND deducted from the store's inventory inside the same
// transaction, and the order is stamped with branchid so it appears in the
// store panel immediately.
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

    // The store the customer is ordering from. Optional: when omitted the
    // legacy behaviour (admin catalogue pricing) is preserved.
    let branch = null;
    if (body.branchId) {
      branch = await Branch.findByUuid(body.branchId);
      if (!branch || branch.status !== "ACTIVE") {
        return Response.json(
          { success: false, message: "Selected store is not available" },
          { status: 400, headers: corsHeaders() }
        );
      }
    }

    // Fetch fresh product truth for every cart line, joined with the
    // selected store's pricing/stock when a store is chosen.
    const productUuids = items.map((i) => i.product_uuid);
    const productResult = await pool.query(
      branch
        ? `
      SELECT p.id AS product_id, p.uuid, p.name, p.sku, p.price, p.discount_price, p.status,
             p.inventory_mode,
             bp.sellingPrice       AS branch_price,
             bp.compareAtPrice     AS branch_compare_price,
             bp.availableQuantity  AS branch_stock,
             bp.status             AS branch_status,
             bp.isAvailable        AS branch_is_available
      FROM products p
      LEFT JOIN branch_products bp
        ON bp.productId = p.id AND bp.branchId = $2
      WHERE p.uuid = ANY($1::uuid[])
      `
        : `
      SELECT id AS product_id, uuid, name, sku, price, discount_price, stock,
             status, inventory_mode
      FROM products
      WHERE uuid = ANY($1::uuid[])
      `,
      branch ? [productUuids, branch.id] : [productUuids]
    );

    const byUuid = new Map(
      productResult.rows.map((p) => [
        p.uuid,
        {
          ...p,
          productId: p.product_id != null ? Number(p.product_id) : null,
          price: Number(p.price) || 0,
          stock: Number(p.stock) || 0,
          branch_price: p.branch_price != null ? Number(p.branch_price) : null,
          branch_stock:
            p.branch_stock != null ? Number(p.branch_stock) : null,
        },
      ])
    );

    client = await pool.connect();
    await client.query("BEGIN");

    let customerId = body.customer_id || null;
    if (!customerId && customerEmail) {
      const found = await client.query(`SELECT id FROM customers WHERE email = $1`, [customerEmail]);
      if (found.rows.length > 0) {
        customerId = found.rows[0].id;
      } else {
        try {
          const created = await client.query(
            `INSERT INTO customers (name, email, mobile, address, status)
             VALUES ($1, $2, $3, $4, 'ACTIVE')
             RETURNING id`,
            [customerName, customerEmail, customerMobile || null, JSON.stringify(shippingAddress)]
          );
          customerId = created.rows[0].id;
        } catch (error) {
          // Two checkouts racing first-order creation: reuse the winner.
          if (error?.code !== "23505") throw error;
          const retry = await client.query(`SELECT id FROM customers WHERE email = $1`, [customerEmail]);
          customerId = retry.rows[0]?.id || null;
        }
      }
    }

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

      let unitPrice;
      let lineSubtotal;

      if (branch) {
        // Store-scoped ordering: the line must exist at the selected store
        // and be available there; price and stock both come from the store.
        if (
          product.branch_status !== "ACTIVE" ||
          product.branch_is_available === false ||
          product.branch_price == null
        ) {
          await client.query("ROLLBACK");
          return Response.json(
            {
              success: false,
              message: `"${product.name}" is not available at the selected store`,
              product: product.uuid,
            },
            { status: 400, headers: corsHeaders() }
          );
        }

        // sellingPrice is the real charge; compareAtPrice is MRP shown only
        // as a strikethrough in the catalog. Charging compareAtPrice would
        // overcharge customers vs the effectivePrice they saw.
        unitPrice = product.branch_price != null ? Number(product.branch_price) : 0;

        if (product.branch_stock < quantity) {
          await client.query("ROLLBACK");
          return Response.json(
            {
              success: false,
              message: `${product.branch_stock} of "${product.name}" left in stock at this store`,
              product: product.uuid,
            },
            { status: 400, headers: corsHeaders() }
          );
        }

        lineSubtotal = unitPrice * quantity;
        subtotal += lineSubtotal;

        insertedItems.push({
          product_id: product.productId,
          product_uuid: product.uuid,
          product_name: product.name,
          sku: product.sku,
          variant: item.variant || null,
          price: unitPrice,
          quantity,
          subtotal: lineSubtotal,
        });
      } else {
        // Legacy admin-catalogue ordering (no store selected).
        unitPrice =
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

        lineSubtotal = unitPrice * quantity;
        subtotal += lineSubtotal;

        insertedItems.push({
          product_id: product.productId,
          product_uuid: product.uuid,
          product_name: product.name,
          sku: product.sku,
          variant: item.variant || null,
          price: unitPrice,
          quantity,
          subtotal: lineSubtotal,
        });
      }

      // Deduct stock server-side inside the transaction: store inventory
      // when ordering from a store, central stock otherwise. The guarded
      // WHERE clause makes overselling impossible under concurrency.
      if (branch && product.branch_stock != null) {
        const dec = await client.query(
          `UPDATE branch_products
           SET stockquantity = stockquantity - $1, updatedat = now()
           WHERE branchid = $2 AND productid = (SELECT id FROM products WHERE uuid = $3)
             AND stockquantity - reservedquantity >= $1`,
          [quantity, branch.id, product.uuid]
        );
        stockUpdates += dec.rowCount;
      } else if (!branch && product.inventory_mode === "SIMPLE") {
        const dec = await client.query(
          `UPDATE products SET stock = stock - $1, updated_at = now()
           WHERE uuid = $2 AND stock >= $1`,
          [quantity, product.uuid]
        );
        stockUpdates += dec.rowCount;
      }
    }

    if (branch && stockUpdates !== items.length) {
      // At least one line failed its guarded stock decrement (concurrent
      // checkout raced us) — nothing is persisted.
      await client.query("ROLLBACK");
      return Response.json(
        {
          success: false,
          message: "Stock changed while placing your order. Please review your cart and try again.",
        },
        { status: 409, headers: corsHeaders() }
      );
    }

    // Estimated delivery: 45-60 minute store delivery window.
    const estimatedDeliveryAt = new Date(Date.now() + 60 * 60 * 1000);

    // Create order header (payment_pending COD; sandbox gateways marked
    // PENDING too — a real gateway would webhook it to PAID).
    const order = await Order.create(
      {
        customerId,
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
        paymentStatus: "PENDING",
        branchId: branch ? branch.id : null,
        estimatedDeliveryAt,
      },
      client
    );

    for (const line of insertedItems) {
      await client.query(
        `
        INSERT INTO order_items
          (order_id, product_id, product_uuid, product_name, sku, variant, price, quantity, subtotal, branchId)
        VALUES ((SELECT id FROM orders WHERE uuid = $1), $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          order.uuid,
          line.product_id,
          line.product_uuid,
          line.product_name,
          line.sku,
          line.variant,
          line.price,
          line.quantity,
          line.subtotal,
          branch ? branch.id : null,
        ]
      );
    }

    // Seed the status audit trail with the initial PENDING entry.
    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ((SELECT id FROM orders WHERE uuid = $1), $2, $3, $4)`,
      [order.uuid, ORDER_STATUS.PENDING, "Order placed", customerEmail]
    );

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
        estimatedDeliveryAt,
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
      { success: false, message: "Checkout failed. Please try again.", debug: String(error?.message || error) },
      { status: 500, headers: corsHeaders() }
    );
  }
}
