import { corsHeaders } from "./cors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

export function invalidUuidResponse() {
  return Response.json(
    { success: false, message: "Invalid id" },
    { status: 404, headers: corsHeaders() }
  );
}