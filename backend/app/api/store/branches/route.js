import { corsHeaders } from "@/lib/cors";
import { Branch } from "@/lib/models/branch";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// Public storefront store list: ACTIVE branches with delivery enabled,
// optionally narrowed to the branches serving a pincode and/or coordinate.
// No auth: the catalog is public, and the admin /api/branches list requires
// branches.view, which plain shopper accounts do not hold.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url, process.env.APP_URL || "http://localhost:3000");
    const branches = await Branch.listServingBranches({
      pincode: searchParams.get("pincode") || "",
      lat: Number(searchParams.get("lat") || 0),
      lng: Number(searchParams.get("lng") || 0),
      limit: Number(searchParams.get("limit") || 100),
    });
    return Response.json({ success: true, branches }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    console.error("List serving stores error:", error);
    return Response.json({ success: false, message: "Could not load stores." }, { status: 500, headers: corsHeaders() });
  }
}
