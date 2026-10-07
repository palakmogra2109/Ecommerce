import pool from "./db.js";
import { round2 } from "./giftCardRules.js";

// Minimum Order Value.
//
// One value, read on every cart render and enforced on every checkout. Nothing
// here is hard-coded: the amount and the on/off flag both come from
// store_settings, which an admin writes through the settings route.
//
// The figure compared is the order SUBTOTAL -- the sum of line totals after
// variant/branch pricing. Delivery, payment fees and taxes are deliberately
// excluded, because the rule is about how much goods a customer is ordering, not
// what they end up paying. Coupons and gift cards reduce what is payable, not
// what was ordered, so they are not netted off either; otherwise a large coupon
// would silently unlock checkout that the business did not intend to allow.
//
// The message is built here rather than in the UI so the cart and the checkout
// rejection can never word the rule differently.

const AMOUNT_KEY = "order.min_order_value.amount";
const ENABLED_KEY = "order.min_order_value.enabled";

export const MOV_KEYS = Object.freeze({ AMOUNT_KEY, ENABLED_KEY });

/** Reads the rule. Missing rows mean "no minimum", which is the safe default. */
export async function getMinimumOrderValue() {
  const result = await pool.query(
    `SELECT key, value FROM store_settings WHERE key = ANY($1::text[])`,
    [[AMOUNT_KEY, ENABLED_KEY]]
  );
  const found = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));

  const rawAmount = found[AMOUNT_KEY];
  const amount = rawAmount === undefined || rawAmount === null || rawAmount === "" ? 0 : Number(rawAmount);
  const enabled = String(found[ENABLED_KEY] ?? "false").toLowerCase() === "true";

  return {
    enabled: enabled && amount > 0,
    amount: round2(Number.isFinite(amount) && amount > 0 ? amount : 0),
  };
}

export class OrderSettingsError extends Error {
  constructor(message) {
    super(message);
    this.code = "INVALID_SETTING";
  }
}

/**
 * Parses and validates a submitted amount.
 *
 * Rejects rather than coerces on the things a text input can produce: negative,
 * NaN, Infinity. Two decimals is rupee precision, so 10.999 is refused instead
 * of silently becoming 11.00.
 */
export function parseAmount(raw) {
  if (raw === null || raw === undefined || raw === "") return 0;
  const value = typeof raw === "number" ? raw : Number(String(raw).trim().replace(/,/g, ""));
  if (!Number.isFinite(value)) throw new OrderSettingsError("Enter a valid amount");
  if (value < 0) throw new OrderSettingsError("Minimum order value cannot be negative");
  if (value > 9999999999) throw new OrderSettingsError("That amount is too large");
  // Compared as decimals, not by scaling: 10.999 * 100 is 1099.9, which rounds
  // to 1100 and would sneak through a Math.round comparison.
  if (Number(value.toFixed(2)) !== value) {
    throw new OrderSettingsError("Use no more than two decimal places");
  }
  return round2(value);
}

function parseEnabled(raw) {
  if (typeof raw === "boolean") return raw;
  const value = String(raw ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on", "enabled"].includes(value)) return true;
  if (["false", "0", "no", "off", "disabled", ""].includes(value)) return false;
  throw new OrderSettingsError("Enabled must be true or false");
}

/**
 * Writes the rule and records the change. Both halves share a transaction, so a
 * history row can never exist for a value that was not stored.
 */
export async function setMinimumOrderValue({ amount, enabled }, changedBy = null, client = null) {
  const nextAmount = parseAmount(amount);
  const nextEnabled = parseEnabled(enabled);

  const db = client || pool;
  const owned = client ? null : await db.connect();
  const runner = owned || db;
  try {
    if (owned) await runner.query("BEGIN");

    // Read the old values inside this transaction and under FOR UPDATE, so a
    // concurrent save cannot interleave and leave the history out of order.
    const previous = await runner.query(
      `SELECT key, value FROM store_settings WHERE key = ANY($1::text[]) FOR UPDATE`,
      [[AMOUNT_KEY, ENABLED_KEY]]
    );
    const old = Object.fromEntries(previous.rows.map((r) => [r.key, r.value]));

    for (const [key, value] of [
      [AMOUNT_KEY, String(nextAmount)],
      [ENABLED_KEY, String(nextEnabled)],
    ]) {
      await runner.query(
        `INSERT INTO store_settings (key, value, is_public, updated_by, updated_at)
         VALUES ($1, $2, TRUE, $3, now())
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value,
               updated_by = EXCLUDED.updated_by,
               updated_at = now()`,
        [key, value, changedBy]
      );
    }

    await runner.query(
      `INSERT INTO min_order_value_history
         (previous_amount, new_amount, previous_enabled, new_enabled,
          changed_by, changed_by_email, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        old[AMOUNT_KEY] === undefined ? null : Number(old[AMOUNT_KEY]),
        nextAmount,
        String(old[ENABLED_KEY] ?? "false").toLowerCase() === "true",
        nextEnabled,
        changedBy,
        null,
        "Minimum order value updated",
      ]
    );

    if (owned) await runner.query("COMMIT");
    return { enabled: nextEnabled && nextAmount > 0, amount: nextAmount };
  } catch (error) {
    if (owned) await runner.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (owned) owned.release();
  }
}

/**
 * The rule applied to a subtotal, and the message for whatever is short.
 *
 * `subtotal` must be the server-computed order subtotal, never a client figure.
 */
export function evaluateMinimumOrderValue(subtotal, rule) {
  const value = round2(Number(subtotal) || 0);
  const satisfied = !rule.enabled || value >= rule.amount;

  return {
    satisfied,
    enabled: rule.enabled,
    minimum: rule.amount,
    subtotal: value,
    remaining: satisfied ? 0 : round2(rule.amount - value),
    // Three distinct messages, so the cart can show progress rather than a
    // single static sentence.
    message: satisfied
      ? rule.enabled
        ? "Minimum order requirement met."
        : ""
      : value <= 0
        ? `Minimum order value is ${formatMoney(rule.amount)}. Add items worth ${formatMoney(rule.amount)} to continue.`
        : `Minimum order value is ${formatMoney(rule.amount)}. Please add ${formatMoney(rule.amount - value)} more to place your order.`,
  };
}

export function formatMoney(value) {
  return `\u20b9${round2(Number(value) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}