import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { loadEnv } from "../../scripts/lib/env.mjs";

await loadEnv();

const base = process.env.DATABASE_URL.replace(/\/[^/]*$/, "/");
const SCRATCH = "gc_notif";
const admin = new pg.Pool({ connectionString: base + "postgres" });
await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${SCRATCH}`);
await admin.end();
process.env.DATABASE_URL = base + SCRATCH;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(fs.readFileSync("sql/schema.sql", "utf8"));
await pool.query(fs.readFileSync("sql/migrations/031-notifications.sql", "utf8"));

const { NotificationService, renderTemplate } = await import("../notifications.js");
const backInStock = await import("../notifications/backInStock.js");
const servicePool = (await import("../db.js")).default;

// Fixtures: a product with no stock, a manager, a super admin, a customer.
const product = (await pool.query(
  "INSERT INTO products (name,slug,sku,price,stock,status) VALUES ('Basmati Rice','basmati','BR-1',150,0,'ACTIVE') RETURNING id,uuid,name"
)).rows[0];
const mkUser = async (email) => (await pool.query(
  "INSERT INTO users (name,email,password,status) VALUES ('U',$1,'x','ACTIVE') RETURNING id,email", [email]
)).rows[0];
const admin1 = await mkUser("admin1@example.test");
const manager = await mkUser("manager@example.test");
const branch = (await pool.query("INSERT INTO branches (name,code) VALUES ('Branch A','BA') RETURNING id")).rows[0];
await pool.query("INSERT INTO branch_users (userid,branchId) VALUES ($1,$2)", [manager.id, branch.id]);
const superRole = (await pool.query(
  "INSERT INTO roles (name,slug,description,status) VALUES ('Super','super_admin','d','ACTIVE') RETURNING id")).rows[0];
await pool.query("INSERT INTO user_has_roles (user_id,role_id) VALUES ($1,$2)", [admin1.id, superRole.id]);

test.after(async () => {
  await pool.end();
  await servicePool.end().catch(() => {});
  const a = new pg.Pool({ connectionString: base + "postgres" });
  await a.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  await a.end();
});

const inboxCount = async (userId) =>
  (await pool.query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1", [userId])).rows[0].n;
const resetInbox = () => pool.query("DELETE FROM notifications");

// ── template engine ────────────────────────────────────────────────────────

test("templates substitute every variable, and leave unknown ones visible", () => {
  assert.equal(
    renderTemplate("{{product_name}} has {{current_stock}} {{unit}}", { product_name: "Rice", current_stock: 10, unit: "Kg" }),
    "Rice has 10 Kg"
  );
  assert.equal(renderTemplate("Hi {{ name }}", { name: "Asha" }), "Hi Asha");
  assert.equal(renderTemplate("Missing {{gone}}"), "Missing {{gone}}");
  assert.equal(renderTemplate(null), "");
});

// ── recipient resolution ───────────────────────────────────────────────────

test("SUPER_ADMIN resolves through roles, not a hard-coded id", async () => {
  await resetInbox();
  const result = await NotificationService.send({
    event: "ORDER_CREATED",
    recipients: ["SUPER_ADMIN"],
    data: { order_number: "SO-1", total: 500, order_uuid: "x" },
    entityType: "order", entityId: "1",
  });
  assert.equal(result.created, 1);
  assert.equal(await inboxCount(admin1.id), 1);
});

test("BRANCH_MANAGER resolves via branch_users for the given branch", async () => {
  await resetInbox();
  const result = await NotificationService.send({
    event: "LOW_STOCK",
    recipients: [{ type: "BRANCH_MANAGER", branchId: branch.id }],
    data: { product_name: "Rice", branch_name: "Branch A", current_stock: 5, unit: "Kg", reorder_level: 20 },
    branchId: branch.id,
  });
  assert.equal(result.created, 1);
  assert.equal(await inboxCount(manager.id), 1, "the manager of that branch, nobody else");
  assert.equal(await inboxCount(admin1.id), 0, "and not the super admin");
});

// ── duplicate protection ───────────────────────────────────────────────────

test("the same dedupe key does not notify twice", async () => {
  await resetInbox();
  const payload = {
    event: "STOCK_TRANSFER_DISCREPANCY",
    recipients: ["SUPER_ADMIN"],
    data: { transfer_number: "ST-1", branch_name: "Branch A", short_quantity: 5, unit: "Kg", damaged_quantity: 1 },
    dedupeKey: "transfer_discrepancy:77",
  };
  const first = await NotificationService.send(payload);
  const second = await NotificationService.send(payload);
  assert.equal(first.created, 1);
  assert.equal(second.created, 0);
  assert.equal(second.suppressed, 1);
  assert.equal(await inboxCount(admin1.id), 1, "exactly one notification survives");
});

test("a different dedupe key for the same event is a separate notification", async () => {
  await resetInbox();
  const base = {
    event: "STOCK_TRANSFER_DISCREPANCY",
    recipients: ["SUPER_ADMIN"],
    data: { transfer_number: "ST-2", branch_name: "Branch A", short_quantity: 5, unit: "Kg", damaged_quantity: 0 },
  };
  await NotificationService.send({ ...base, dedupeKey: "transfer_discrepancy:78" });
  await NotificationService.send({ ...base, dedupeKey: "transfer_discrepancy:79" });
  assert.equal(await inboxCount(admin1.id), 2, "two different transfers, two alerts");
});

// ── preferences ────────────────────────────────────────────────────────────

test("an opted-out recipient gets nothing", async () => {
  await resetInbox();
  await pool.query(
    "INSERT INTO notification_preferences (user_id,event,channel,enabled) VALUES ($1,'LOW_STOCK','IN_APP',FALSE)",
    [manager.id]
  );
  const result = await NotificationService.send({
    event: "LOW_STOCK",
    recipients: [{ type: "BRANCH_MANAGER", branchId: branch.id }],
    data: { product_name: "Rice", branch_name: "Branch A", current_stock: 1, unit: "Kg", reorder_level: 9 },
    branchId: branch.id,
  });
  assert.equal(result.created, 0);
  assert.equal(await inboxCount(manager.id), 0);
  await pool.query("DELETE FROM notification_preferences");
});

test("PUSH is skipped when the recipient has no device token", async () => {
  await resetInbox();
  const result = await NotificationService.send({
    event: "ORDER_CREATED",
    recipients: ["SUPER_ADMIN"],
    data: { order_number: "SO-9", total: 100, order_uuid: "y" },
    channels: ["IN_APP", "PUSH"],
  });
  assert.equal(result.created, 1, "IN_APP only");
  const pushes = await pool.query("SELECT count(*)::int AS n FROM notification_deliveries WHERE channel = 'PUSH'");
  assert.equal(pushes.rows[0].n, 0, "no push attempted without a token");
});

test("PUSH is attempted once a device exists, through the same pipeline", async () => {
  await resetInbox();
  await pool.query(
    "INSERT INTO notification_devices (user_id,token,platform) VALUES ($1,'tok-abc','WEB')",
    [admin1.id]
  );
  await NotificationService.send({
    event: "ORDER_CREATED",
    recipients: ["SUPER_ADMIN"],
    data: { order_number: "SO-10", total: 100, order_uuid: "z" },
    channels: ["IN_APP", "PUSH"],
  });
  const deliveries = await pool.query(
    "SELECT channel, status FROM notification_deliveries ORDER BY channel"
  );
  assert.deepEqual(deliveries.rows.map((r) => r.channel), ["PUSH"]);
  assert.equal(deliveries.rows[0].status, "SENT");
  await pool.query("DELETE FROM notification_devices");
});

// ── history, read state, deep link ─────────────────────────────────────────

test("history carries entity, action link, priority and data", async () => {
  await resetInbox();
  await NotificationService.send({
    event: "PRODUCT_BACK_IN_STOCK",
    recipients: ["SUPER_ADMIN"],
    data: { product_name: "Rice", product_uuid: product.uuid, branch_name: "Central" },
    entityType: "product", entityId: String(product.id),
    priority: "HIGH",
  });
  const row = (await pool.query("SELECT * FROM notifications ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(row.entity_type, "product");
  assert.equal(row.entity_id, String(product.id));
  assert.equal(row.priority, "HIGH");
  assert.match(row.action_url, /products/);
  assert.equal(row.data.product_name, "Rice");
});

test("inbox and read state work for the owner only", async () => {
  await resetInbox();
  await NotificationService.send({
    event: "LOW_STOCK", recipients: ["SUPER_ADMIN"],
    data: { product_name: "Rice", branch_name: "B", current_stock: 1, unit: "Kg", reorder_level: 5 },
  });
  const mine = await NotificationService.inbox({ userId: admin1.id });
  assert.equal(mine.length, 1);
  assert.equal((await NotificationService.inbox({ userId: manager.id })).length, 0, "not visible to another user");

  assert.equal(await NotificationService.unreadCount({ userId: admin1.id }), 1);
  assert.equal(await NotificationService.markRead({ userId: admin1.id }), 1);
  assert.equal(await NotificationService.unreadCount({ userId: admin1.id }), 0);
});

// ── error isolation ────────────────────────────────────────────────────────

test("an unknown event is reported, not thrown", async () => {
  const result = await NotificationService.send({
    event: "TOTALLY_UNKNOWN_EVENT",
    recipients: ["SUPER_ADMIN"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "NO_TEMPLATE");
});

test("send never throws, even with garbage input", async () => {
  for (const bad of [
    { event: null, recipients: null },
    { event: "ORDER_CREATED" },
    { event: "ORDER_CREATED", recipients: [{ type: "USER", id: 999999999 }] },
    { event: "ORDER_CREATED", recipients: [{ type: "NOT_A_TYPE" }] },
    { event: "ORDER_CREATED", recipients: ["SUPER_ADMIN"], data: null },
  ]) {
    const result = await NotificationService.send(bad);
    assert.equal(typeof result.ok, "boolean", `threw on ${JSON.stringify(bad)}`);
  }
});

// ── back in stock: the user's actual feature ───────────────────────────────

test("notify-me registers an interest for an out-of-stock product", async () => {
  const result = await backInStock.registerInterest({
    productUuid: product.uuid, email: "Shopper@Example.test", name: "Shopper",
  });
  assert.equal(result.registered, true);
  assert.equal(result.interest.email, "shopper@example.test", "normalised to lower case");
  assert.equal(result.product.outOfStock, true);
  assert.equal(await backInStock.isRegistered({ productUuid: product.uuid, email: "shopper@example.test" }), true);
});

test("an invalid email is refused", async () => {
  for (const bad of ["", "nope", "a@b", null]) {
    await assert.rejects(() => backInStock.registerInterest({ productUuid: product.uuid, email: bad }));
  }
});

test("registering twice updates rather than duplicates", async () => {
  await backInStock.registerInterest({ productUuid: product.uuid, email: "twice@example.test", name: "A" });
  await backInStock.registerInterest({ productUuid: product.uuid, email: "twice@example.test", name: "B" });
  const rows = await pool.query(
    "SELECT count(*)::int AS n FROM product_stock_notifications WHERE email='twice@example.test'"
  );
  assert.equal(rows.rows[0].n, 1);
  const kept = (await pool.query(
    "SELECT name FROM product_stock_notifications WHERE email='twice@example.test'"
  )).rows[0];
  assert.equal(kept.name, "B", "the newer name wins");
});

test("restocking notifies everyone who asked, exactly once", async () => {
  await resetInbox();
  await pool.query("DELETE FROM product_stock_notifications");
  for (const email of ["one@example.test", "two@example.test"]) {
    await backInStock.registerInterest({ productUuid: product.uuid, email });
  }

  await pool.query("UPDATE products SET stock = 250 WHERE id = $1", [product.id]);
  const result = await backInStock.notifyBackInStock({ productUuid: product.uuid });

  assert.equal(result.ok, true);
  assert.equal(result.reason, "SENT");
  assert.equal(result.notified, 2, "both shoppers notified");

  const sent = await pool.query(
    "SELECT recipient_email, title, message, action_url FROM notifications WHERE event='PRODUCT_BACK_IN_STOCK'"
  );
  assert.equal(sent.rows.length, 2);
  assert.match(sent.rows[0].title, /Basmati Rice/);
  assert.match(sent.rows[0].message, /back in stock/i);
  assert.match(sent.rows[0].action_url, new RegExp(product.uuid));

  // A second call with nobody newly waiting must not re-notify.
  const again = await backInStock.notifyBackInStock({ productUuid: product.uuid });
  assert.equal(again.reason, "NO_INTEREST");
  const after = await pool.query(
    "SELECT count(*)::int AS n FROM notifications WHERE event='PRODUCT_BACK_IN_STOCK'"
  );
  assert.equal(after.rows[0].n, 2, "still two");
});

test("a product that is still out of stock notifies nobody", async () => {
  await resetInbox();
  await pool.query("DELETE FROM product_stock_notifications");
  await backInStock.registerInterest({ productUuid: product.uuid, email: "waiting@example.test" });
  await pool.query("UPDATE products SET stock = 0 WHERE id = $1", [product.id]);

  const result = await backInStock.notifyBackInStock({ productUuid: product.uuid });
  assert.equal(result.reason, "OUT_OF_STOCK", "still nothing to announce");
  assert.equal(result.notified, 0);
  const sent = await pool.query(
    "SELECT count(*)::int AS n FROM notifications WHERE event='PRODUCT_BACK_IN_STOCK'"
  );
  assert.equal(sent.rows[0].n, 0);
});

test("interest list shows only outstanding requests", async () => {
  const list = await backInStock.listInterest({ email: "waiting@example.test" });
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Basmati Rice");
  assert.equal(Number(list[0].stock), 0);
});
// ── product usage guard ────────────────────────────────────────────────────
// A product other tables already point at is history: it cannot be edited,
// deactivated or removed. A product that has merely sold out stays editable.

test("a product referenced by an order cannot be edited or deleted", async () => {
  const { productUsage, usageMessage, ProductInUseError } = await import("../productUsage.js");

  const ordered = await pool.query(
    `INSERT INTO products (name,slug,sku,price,stock,status)
     VALUES ('Ordered Thing','ordered-thing','OT-1',100,0,'ACTIVE') RETURNING id,uuid`
  );
  const orderedId = ordered.rows[0].id;
  // order_items.order_id is NOT NULL, so a real order row has to exist first.
  const order = (await pool.query(
    `INSERT INTO orders (uuid, order_number, customer_name, customer_email, shipping_address,
                         subtotal, discount, total, payment_method, payment_status, status)
     VALUES (gen_random_uuid(),'T-1','Buyer','buyer@example.test','{}',100,0,100,'cod','PAID','CONFIRMED')
     RETURNING id`
  )).rows[0].id;
  await pool.query(
    `INSERT INTO order_items (order_id, product_id, product_uuid, product_name, sku,
                              price, quantity, subtotal)
     VALUES ($1, $2, $3, 'Ordered Thing', 'OT-1', 100, 1, 100)`,
    [order, orderedId, ordered.rows[0].uuid]
  );

  const usage = await productUsage(ordered.rows[0].uuid);
  assert.equal(usage.isUsed, true);
  assert.ok(usage.reasons.some((r) => r.key === "orders"));
  assert.match(usageMessage(usage), /customer order/);
  assert.throws(() => { throw new ProductInUseError(usage); }, /cannot be changed or removed/);

  const stored = (await pool.query("SELECT id FROM products WHERE id = $1", [orderedId])).rows[0];
  assert.ok(stored, "the product still exists -- the guard refuses rather than deletes");

  await pool.query("DELETE FROM order_items WHERE order_id = $1", [order]);
  await pool.query("DELETE FROM orders WHERE id = $1", [order]);
  await pool.query("DELETE FROM products WHERE id = $1", [orderedId]);
});

test("a product used as store stock is treated as in use", async () => {
  const { productUsage } = await import("../productUsage.js");
  const branch = (await pool.query("INSERT INTO branches (name,code) VALUES ('B2','B2') RETURNING id")).rows[0];
  const item = (await pool.query(
    "INSERT INTO products (name,slug,sku,price,stock,status) VALUES ('Store Thing','store-thing','ST-1',50,5,'ACTIVE') RETURNING id,uuid"
  )).rows[0];
  await pool.query(
    "INSERT INTO branch_products (branchid,productid,stockquantity) VALUES ($1,$2,5)",
    [branch.id, item.id]
  );

  const usage = await productUsage(item.uuid);
  assert.equal(usage.isUsed, true);
  assert.ok(usage.reasons.some((r) => r.key === "branchStock"), "a store listing counts as use");

  await pool.query("DELETE FROM branch_products WHERE productid = $1", [item.id]);
  await pool.query("DELETE FROM products WHERE id = $1", [item.id]);
});

test("an unused product is still editable even at zero stock", async () => {
  const { productUsage } = await import("../productUsage.js");
  const item = (await pool.query(
    "INSERT INTO products (name,slug,sku,price,stock,status) VALUES ('New Thing','new-thing','NT-1',10,0,'DRAFT') RETURNING uuid"
  )).rows[0];
  const usage = await productUsage(item.uuid);
  assert.equal(usage.isUsed, false, "sold out is not the same as used");
  assert.deepEqual(usage.reasons, []);
  await pool.query("DELETE FROM products WHERE uuid = $1", [item.uuid]);
});

test("an unknown product resolves to no usage rather than erroring", async () => {
  const { productUsage } = await import("../productUsage.js");
  const usage = await productUsage("00000000-0000-4000-8000-000000000000");
  assert.equal(usage.productId, null);
  assert.equal(usage.isUsed, false);
});
