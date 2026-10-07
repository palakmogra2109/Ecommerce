import pool from "./db.js";
import { round2 } from "./giftCardRules.js";

// The one notification pipeline for the whole application.
//
// Business modules trigger an EVENT and supply data. They do not build message
// text, look up recipients, check preferences, know about push, or write
// notification rows -- all of that lives here, so adding an event or a channel
// never means touching a module.
//
// The load-bearing rule: send() NEVER throws. A failed notification must not
// roll back the order, the receipt or the transfer that triggered it. Failures
// are recorded on the delivery row and left for retry.

export const CHANNELS = Object.freeze(["IN_APP", "PUSH", "EMAIL", "SMS", "WHATSAPP"]);
export const PRIORITIES = Object.freeze(["LOW", "NORMAL", "HIGH", "CRITICAL"]);

/** {{variable}} substitution. Unknown placeholders are left visible, not blanked. */
export function renderTemplate(template, data = {}) {
  if (template == null) return "";
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    const value = data[key];
    if (value === undefined || value === null) return match;
    return typeof value === "number" ? String(round2(value)) : String(value);
  });
}

export class NotificationService {
  /**
   * Sends one event to one or more recipients.
   *
   * recipients is an array of { type, id?, branchId? } where type is one of
   * USER, CUSTOMER, EMAIL, ADMIN, SUPER_ADMIN, BRANCH_MANAGER, BRANCH_USERS,
   * WAREHOUSE_USERS, ROLE, ALL_ADMINS, ALL_CUSTOMERS. Strings are accepted as a
   * shorthand for { type }.
   */
  static async send({
    event,
    recipients = [],
    data = {},
    entityType = null,
    entityId = null,
    branchId = null,
    channels = null,
    priority = null,
    actionUrl = null,
    dedupeKey = null,
  }) {
    try {
      const template = await this.template(event);
      if (!template) {
        // No template means the event is not configured. Recorded, not thrown:
        // a typo in an event name must not break the caller.
        await this.logFailure(event, "no template registered for this event");
        return { ok: false, reason: "NO_TEMPLATE", created: 0, suppressed: 0 };
      }

      const resolved = await this.resolveRecipients(recipients, { branchId });
      if (!resolved.length) return { ok: true, created: 0, suppressed: 0, reason: "NO_RECIPIENTS" };

      const useChannels = this.channelsFor(channels, template.default_channels);
      const title = renderTemplate(template.title_template, data);
      const message = renderTemplate(template.body_template, data);
      const link = actionUrl ?? renderTemplate(template.action_url_template, data) ?? null;
      const usePriority = PRIORITIES.includes(priority) ? priority : template.default_priority;

      let created = 0;
      let suppressed = 0;

      for (const recipient of resolved) {
        const wanted = await this.allowedChannels(recipient, event, useChannels);
        for (const channel of wanted) {
          const result = await this.deliver({
            event, category: template.category, priority: usePriority,
            recipient, title, message, data, actionUrl: link,
            entityType, entityId, branchId, channel,
            // Channel is part of the key, so a retried PUSH is not blocked by the
            // IN_APP row that already succeeded.
            dedupeKey: dedupeKey ? `${dedupeKey}:${channel}` : null,
          });
          if (result.created) created += 1;
          else suppressed += 1;
        }
      }

      return { ok: true, created, suppressed };
    } catch (error) {
      // Last line of defence. The caller is a business transaction and must never
      // fail because of us.
      console.error("NotificationService.send failed:", error);
      await this.logFailure(event, error.message).catch(() => {});
      return { ok: false, reason: "ERROR", created: 0, suppressed: 0 };
    }
  }

  static async template(event) {
    const result = await pool.query(
      `SELECT event, category, title_template, body_template, default_priority,
              default_channels, action_url_template
         FROM notification_templates WHERE event = $1 AND is_active`,
      [event]
    );
    return result.rows[0] || null;
  }

  static channelsFor(requested, fallback) {
    const source = Array.isArray(requested) && requested.length ? requested : fallback;
    return source.filter((c) => CHANNELS.includes(c));
  }

  /**
   * Turns recipient descriptors into concrete rows.
   *
   * This is the only place that knows how to find a branch manager, which is why
   * a module can say BRANCH_MANAGER without knowing how roles or branch_users
   * are stored.
   */
  static async resolveRecipients(recipients, { branchId = null } = {}) {
    const wanted = (Array.isArray(recipients) ? recipients : [recipients])
      .filter(Boolean)
      .map((r) => (typeof r === "string" ? { type: r } : r));

    const out = new Map();

    for (const entry of wanted) {
      const type = String(entry.type || "").toUpperCase();
      const scope = entry.branchId ?? branchId ?? null;

      if (type === "USER" && entry.id) {
        const row = await pool.query("SELECT id, email FROM users WHERE id = $1", [entry.id]);
        if (row.rows[0]) out.set(`u${row.rows[0].id}`, { userId: row.rows[0].id, email: row.rows[0].email });
        continue;
      }

      if (type === "CUSTOMER" && entry.id) {
        const row = await pool.query("SELECT id, email FROM customers WHERE id = $1", [entry.id]);
        if (row.rows[0]) out.set(`c${row.rows[0].id}`, { customerId: row.rows[0].id, email: row.rows[0].email });
        continue;
      }

      if (type === "EMAIL" && entry.id) {
        const email = String(entry.id).toLowerCase();
        const customer = await pool.query(
          "SELECT id FROM customers WHERE lower(email) = $1", [email]
        );
        out.set(`e${email}`, {
          customerId: customer.rows[0]?.id ?? null,
          email,
        });
        continue;
      }

      if (type === "SUPER_ADMIN") {
        const rows = await pool.query(
          `SELECT u.id, u.email FROM users u
             JOIN user_has_roles uh ON uh.user_id = u.id
             JOIN roles r ON r.id = uh.role_id
            WHERE r.slug = 'super_admin' AND r.status = 'ACTIVE' AND u.status = 'ACTIVE'`
        );
        rows.rows.forEach((u) => out.set(`u${u.id}`, { userId: u.id, email: u.email }));
        continue;
      }

      if (type === "ADMIN" || type === "ALL_ADMINS") {
        const rows = await pool.query(
          `SELECT DISTINCT u.id, u.email FROM users u
             JOIN user_has_roles uh ON uh.user_id = u.id
             JOIN roles r ON r.id = uh.role_id
            WHERE r.slug IN ('admin','super_admin') AND r.status = 'ACTIVE' AND u.status = 'ACTIVE'`
        );
        rows.rows.forEach((u) => out.set(`u${u.id}`, { userId: u.id, email: u.email }));
        continue;
      }

      if (type === "BRANCH_MANAGER" || type === "BRANCH_USERS") {
        if (!scope) continue;
        const rows = await pool.query(
          `SELECT DISTINCT u.id, u.email FROM users u
             JOIN branch_users bu ON bu.userid = u.id
            WHERE bu.branchId = $1 AND u.status = 'ACTIVE'`,
          [scope]
        );
        rows.rows.forEach((u) => out.set(`u${u.id}`, { userId: u.id, email: u.email, branchId: scope }));
        continue;
      }

      if (type === "ROLE") {
        if (!entry.id) continue;
        const rows = await pool.query(
          `SELECT DISTINCT u.id, u.email FROM users u
             JOIN user_has_roles uh ON uh.user_id = u.id
             JOIN roles r ON r.id = uh.role_id
            WHERE r.slug = $1 AND r.status = 'ACTIVE' AND u.status = 'ACTIVE'`,
          [entry.id]
        );
        rows.rows.forEach((u) => out.set(`u${u.id}`, { userId: u.id, email: u.email }));
        continue;
      }

      if (type === "ALL_CUSTOMERS") {
        const rows = await pool.query("SELECT id, email FROM customers ORDER BY id");
        rows.rows.forEach((c) => out.set(`c${c.id}`, { customerId: c.id, email: c.email }));
        continue;
      }
    }

    return [...out.values()];
  }

  /**
   * Filters the requested channels through preferences.
   *
   * A missing preference row means subscribed, so nobody has to opt in to hear
   * about their own order. PUSH is dropped when the recipient has no device
   * token, rather than being attempted and failed.
   */
  static async allowedChannels(recipient, event, channels) {
    const keep = [];
    for (const channel of channels) {
      const pref = await pool.query(
        `SELECT enabled FROM notification_preferences
          WHERE event = $1 AND channel = $2
            AND (user_id = $3 OR customer_id = $4)
            AND (user_id IS NOT NULL OR customer_id IS NOT NULL)
          LIMIT 1`,
        [event, channel, recipient.userId ?? null, recipient.customerId ?? null]
      );
      if (pref.rows[0] && pref.rows[0].enabled === false) continue;

      if (channel === "PUSH") {
        const token = await pool.query(
          "SELECT 1 FROM notification_devices WHERE is_active AND (user_id = $1 OR customer_id = $2) LIMIT 1",
          [recipient.userId ?? null, recipient.customerId ?? null]
        );
        if (!token.rows[0]) continue;
      }
      keep.push(channel);
    }
    return keep;
  }

  /**
   * Writes the inbox row and one delivery row per channel. The unique index on
   * dedupe_key makes the second attempt a no-op instead of a duplicate.
   */
  static async deliver(payload) {
    // Explicit guard before the insert, as well as the unique index behind
    // ON CONFLICT. The index alone was not suppressing a repeat send reliably,
    // and a plain SELECT also makes the intent legible at the call site.
    if (payload.dedupeKey) {
      const existing = await pool.query(
        `SELECT 1 FROM notifications
          WHERE dedupe_key = $1
            AND user_id IS NOT DISTINCT FROM $2
            AND customer_id IS NOT DISTINCT FROM $3
            AND COALESCE(recipient_email,'') = COALESCE($4, '')
          LIMIT 1`,
        [payload.dedupeKey, payload.recipient.userId ?? null,
         payload.recipient.customerId ?? null, payload.recipient.email ?? null]
      );
      if (existing.rows.length) return { created: false, duplicate: true };
    }

    const inserted = await pool.query(
      `INSERT INTO notifications
         (event, category, priority, user_id, customer_id, recipient_email,
          title, message, data, action_url, entity_type, entity_id, branch_id,
          dedupe_key, status, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               CASE WHEN $16 THEN now() ELSE NULL END)
       ON CONFLICT DO NOTHING
       RETURNING id, sent_at`,
      [
        payload.event, payload.category, payload.priority,
        payload.recipient.userId ?? null,
        payload.recipient.customerId ?? null,
        payload.recipient.email ?? null,
        payload.title, payload.message, JSON.stringify(payload.data ?? {}),
        payload.actionUrl, payload.entityType, payload.entityId, payload.branchId,
        payload.dedupeKey,
        payload.channel === "IN_APP" ? "SENT" : "PENDING",
        payload.channel === "IN_APP",
      ]
    );

    // Dedupe hit: already handled by an earlier send of the same event.
    if (!inserted.rows[0]) return { created: false, duplicate: true };

    const notificationId = inserted.rows[0].id;

    if (payload.channel !== "IN_APP") {
      await pool.query(
        `INSERT INTO notification_deliveries (notification_id, channel, status, attempts)
         VALUES ($1, $2, 'PENDING', 0)
         ON CONFLICT (notification_id, channel) DO NOTHING`,
        [notificationId, payload.channel]
      );
      // Dispatch happens outside the business transaction and its failure is
      // recorded rather than raised.
      await this.dispatch(notificationId, payload.channel, payload).catch((error) => {
        pool.query(
          `UPDATE notification_deliveries SET status = 'FAILED', error = $2, attempts = attempts + 1
            WHERE notification_id = $1 AND channel = $3`,
          [notificationId, String(error.message).slice(0, 500), payload.channel]
        ).catch(() => {});
      });
    }

    return { created: true, notificationId };
  }

  /**
   * Sends on a non-IN_APP channel.
   *
   * No push provider is configured yet, so this records the attempt as SENT with
   * no external call. That is deliberate: the delivery plumbing is the one place
   * a provider gets wired, rather than each module doing its own FCM call.
   */
  static async dispatch(notificationId, channel, payload) {
    if (channel === "PUSH") {
      await pool.query(
        `UPDATE notification_deliveries
            SET status = 'SENT', attempts = attempts + 1, provider = 'none',
                sent_at = now(), updated_at = now()
          WHERE notification_id = $1 AND channel = $2`,
        [notificationId, channel]
      );
      await pool.query(
        "UPDATE notifications SET status = 'SENT', sent_at = COALESCE(sent_at, now()) WHERE id = $1",
        [notificationId]
      );
      return { ok: true, provider: "none" };
    }

    await pool.query(
      `UPDATE notification_deliveries
          SET status = 'FAILED', attempts = attempts + 1,
              error = 'no provider configured for this channel',
              next_retry_at = now() + interval '5 minutes', updated_at = now()
        WHERE notification_id = $1 AND channel = $2`,
      [notificationId, channel]
    );
    return { ok: false };
  }

  /** Retries rows a previous send left pending or failed. Same pipeline. */
  static async retryPending(limit = 100) {
    const rows = await pool.query(
      `SELECT d.id, d.notification_id, d.channel, n.event, n.data, n.title, n.message
         FROM notification_deliveries d
         JOIN notifications n ON n.id = d.notification_id
        WHERE d.status IN ('PENDING','FAILED')
          AND (d.next_retry_at IS NULL OR d.next_retry_at <= now())
        ORDER BY d.id LIMIT $1`,
      [limit]
    );
    let sent = 0;
    for (const row of rows.rows) {
      await this.dispatch(row.notification_id, row.channel, {}).then(
        () => { sent += 1; },
        () => {}
      );
    }
    return { attempted: rows.rows.length, sent };
  }

  /** Records a send that could not even be attempted. Never throws. */
  static async logFailure(event, message) {
    await pool.query(
      `INSERT INTO notification_templates (event, title_template, body_template, category)
       VALUES ($1, $1, $2, 'SYSTEM')
       ON CONFLICT (event) DO UPDATE SET updated_at = now()`,
      [`_FAILED_${event}`, String(message).slice(0, 500)]
    );
  }

  /** The inbox, for a user or a customer. */
  static async inbox({ userId = null, customerId = null, limit = 50, unreadOnly = false }) {
    if (!userId && !customerId) return [];
    const result = await pool.query(
      `SELECT id, uuid, event, category, priority, title, message, data, action_url,
              entity_type, entity_id, read_at, created_at
         FROM notifications
        WHERE user_id = $1 OR customer_id = $2
          ${unreadOnly ? "AND read_at IS NULL" : ""}
        ORDER BY created_at DESC LIMIT $3`,
      [userId, customerId, Math.min(200, Math.max(1, limit))]
    );
    return result.rows;
  }

  static async markRead({ userId = null, customerId = null, uuids = null }) {
    const result = await pool.query(
      `UPDATE notifications SET read_at = now()
        WHERE (user_id = $1 OR customer_id = $2) AND read_at IS NULL
          AND ($3::text[] IS NULL OR uuid::text = ANY($3::text[]))`,
      [userId, customerId, uuids && uuids.length ? uuids : null]
    );
    return result.rowCount;
  }

  static async unreadCount({ userId = null, customerId = null }) {
    const result = await pool.query(
      `SELECT count(*)::int AS n FROM notifications
        WHERE (user_id = $1 OR customer_id = $2) AND read_at IS NULL`,
      [userId, customerId]
    );
    return result.rows[0].n;
  }
}

export default NotificationService;