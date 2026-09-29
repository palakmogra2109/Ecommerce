const REQUEST_TIMEOUT_MS = 10_000;

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
