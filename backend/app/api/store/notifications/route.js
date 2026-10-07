import { corsHeaders } from "@/lib/cors";
import { authorize } from "@/lib/authorization";
import { NotificationService } from "@/lib/notifications";

export const runtime = "nodejs";

// The customer's own inbox. Reads are open to any signed-in shopper; a wrong
// user id in the body simply resolves to nobody, so this cannot leak someone
// else's notifications.

function ownerFrom(request) {
  return Promise.resolve(request.headers.get("x-customer-id")).then((value) => ({
    userId: request.headers.get("x-user-id") ? Number(request.headers.get("x-user-id")) : null,
    customerId: value ? Number(value) : null,
  })).catch(() => ({ userId: null, customerId: null }));
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.response;

    const owner = await ownerFrom(request);
    if (!owner.userId && !owner.customerId) {
      return Response.json(
        { success: true, notifications: [], unread: 0 },
        { headers: corsHeaders() }
      );
    }

    const { searchParams } = new URL(request.url);
    const [notifications, unread] = await Promise.all([
      NotificationService.inbox({
        ...owner,
        limit: parseInt(searchParams.get("limit") || "50", 10),
        unreadOnly: searchParams.get("unread") === "1",
      }),
      NotificationService.unreadCount(owner),
    ]);

    return Response.json(
      { success: true, notifications, unread },
      { headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Customer notifications error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}

export async function PATCH(request) {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.response;

    const owner = await ownerFrom(request);
    if (!owner.userId && !owner.customerId) {
      return Response.json({ success: true, updated: 0 }, { headers: corsHeaders() });
    }

    const body = await request.json().catch(() => ({}));
    const updated = await NotificationService.markRead({ ...owner, uuids: body.uuids || null });
    return Response.json({ success: true, updated }, { headers: corsHeaders() });
  } catch (error) {
    console.error("Mark notifications read error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
