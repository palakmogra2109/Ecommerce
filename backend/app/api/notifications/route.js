import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { NotificationService } from "@/lib/notifications";

export const runtime = "nodejs";

// The signed-in ADMIN's own inbox.
//
// The store equivalent (app/api/store/notifications) reads the owner id from the
// `x-user-id` / `x-customer-id` request headers, which any caller can set. That
// is tolerable for a storefront where the id is already a bearer-ish token, but
// it is not acceptable behind the admin session: it would let anyone read — and
// mark read — anyone else's notifications simply by sending another id. So this
// route takes the id from `authorize()`, which resolves it from the verified
// session token and ignores whatever the request claims.
//
// No permission gate beyond authentication: an inbox belongs to whoever is
// signed in, and `inbox()`/`unreadCount()` already constrain every query to
// that one user id.

function json(body, status = 200) {
  return Response.json(body, { status, headers: corsHeaders() });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.response;

    const userId = auth.user?.id;
    if (!userId) return json({ success: false, message: "Not authenticated" }, 401);

    const { searchParams } = new URL(request.url);
    const limit = Number.parseInt(searchParams.get("limit") || "50", 10);

    const [notifications, unread] = await Promise.all([
      NotificationService.inbox({
        userId,
        limit: Number.isFinite(limit) ? Math.min(200, Math.max(1, limit)) : 50,
        unreadOnly: searchParams.get("unread") === "1",
      }),
      NotificationService.unreadCount({ userId }),
    ]);

    return json({ success: true, notifications, unread });
  } catch (error) {
    console.error("Admin notifications error:", error);
    return json({ success: false, message: "Internal server error" }, 500);
  }
}

// Marks the listed notifications read. A body with no `uuids` marks the whole
// inbox read, which is what the "mark all read" control sends.
export async function PATCH(request) {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.response;

    const userId = auth.user?.id;
    if (!userId) return json({ success: false, message: "Not authenticated" }, 401);

    const body = await request.json().catch(() => ({}));
    const uuids = Array.isArray(body.uuids)
      ? body.uuids.filter((u) => typeof u === "string" && u).slice(0, 200)
      : null;

    const marked = await NotificationService.markRead({ userId, uuids });
    const unread = await NotificationService.unreadCount({ userId });

    return json({ success: true, marked, unread });
  } catch (error) {
    console.error("Mark notifications read error:", error);
    return json({ success: false, message: "Internal server error" }, 500);
  }
}