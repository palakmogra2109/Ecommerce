import { corsHeaders } from "@/lib/cors";
import { authenticate } from "@/lib/authorization";
import { Customer } from "@/lib/models/customer";
import {
  createAddressEntry,
  deleteAddressEntry,
  mergeClaimedAddresses,
  updateAddressEntry,
} from "@/lib/addressBook";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function failure(message, status) {
  return Response.json({ success: false, message }, { status, headers: corsHeaders() });
}

function success(addresses, extra = {}, status = 200) {
  return Response.json({ success: true, addresses, ...extra }, { status, headers: corsHeaders() });
}

export async function GET() {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;
    const addresses = await Customer.getAddressBookByEmail(auth.user.email);
    return success(addresses);
  } catch (error) {
    console.error("List storefront addresses error:", error);
    return failure("Could not load saved addresses.", 500);
  }
}

export async function POST(request) {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => ({}));
    const result = await Customer.mutateAddressBookByEmail(
      auth.user.email,
      (existing, context) => {
        if (Array.isArray(body.claim)) {
          const merged = mergeClaimedAddresses(existing, body.claim, new Date().toISOString(), {
            name: auth.user.name,
            phone: context.mobile,
          });
          return { addresses: merged.addresses, claimed: merged.claimed };
        }
        const created = createAddressEntry(existing, body);
        if (created.error) return { error: created.error, errors: created.errors, status: 400 };
        return { addresses: [...existing, created.address] };
      },
      { name: auth.user.name }
    );
    if (result.error) {
      return Response.json(
        { success: false, message: result.error, errors: result.errors },
        { status: result.status || 400, headers: corsHeaders() }
      );
    }
    return success(result.addresses, result.claimed == null ? {} : { claimed: result.claimed }, 201);
  } catch (error) {
    console.error("Create storefront address error:", error);
    return failure("Could not save this address.", 500);
  }
}

export async function PATCH(request) {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => ({}));
    if (!body?.id || typeof body.id !== "string") return failure("An address id is required.", 400);
    const result = await Customer.mutateAddressBookByEmail(
      auth.user.email,
      (existing) => {
        const updated = updateAddressEntry(existing, body.id, body);
        if (updated.error) {
          return {
            error: updated.error,
            errors: updated.errors,
            status: updated.error === "Address not found." ? 404 : 400,
          };
        }
        return { addresses: updated.addresses };
      },
      { name: auth.user.name }
    );
    if (result.error) {
      return Response.json(
        { success: false, message: result.error, errors: result.errors },
        { status: result.status || 400, headers: corsHeaders() }
      );
    }
    return success(result.addresses);
  } catch (error) {
    console.error("Update storefront address error:", error);
    return failure("Could not update this address.", 500);
  }
}

export async function DELETE(request) {
  try {
    const auth = await authenticate();
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => ({}));
    if (!body?.id || typeof body.id !== "string") return failure("An address id is required.", 400);
    const result = await Customer.mutateAddressBookByEmail(
      auth.user.email,
      (existing) => {
        if (!existing.some((entry) => entry.id === body.id)) {
          return { error: "Address not found.", status: 404 };
        }
        return { addresses: deleteAddressEntry(existing, body.id) };
      },
      { name: auth.user.name }
    );
    if (result.error) {
      return Response.json(
        { success: false, message: result.error },
        { status: result.status || 400, headers: corsHeaders() }
      );
    }
    return success(result.addresses);
  } catch (error) {
    console.error("Delete storefront address error:", error);
    return failure("Could not delete this address.", 500);
  }
}
