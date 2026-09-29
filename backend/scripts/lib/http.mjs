const REQUEST_TIMEOUT_MS = 10_000;

// Origin of the running Next dev server, for the HTTP-level scenarios. Override
// with API_BASE_URL when the server is not on the default port.
//
// FRONTEND_URL is deliberately not the fallback here: it is the CORS origin
// that lib/cors.js advertises, i.e. a different application (the Vite client),
// and calling it would test the wrong server.
export const devServer = process.env.API_BASE_URL || "http://localhost:3000";

export function apiUrl(path) {
  return `${devServer}${path.startsWith("/") ? path : `/${path}`}`;
}

async function readBody(r) {
  const text = await r.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export async function jsonPost(url, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: r.status, data: await readBody(r) };
}
export async function apiGet(url, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { status: r.status, data: await readBody(r) };
}
export async function jsonPatch(url, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: r.status, data: await readBody(r) };
}
