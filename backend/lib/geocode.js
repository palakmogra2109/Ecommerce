// Backend-proxied OpenStreetMap Nominatim client for the storefront's
// location search and reverse geocoding.
//
// The browser never calls Nominatim directly: the proxy keeps the required
// User-Agent, rate limiting, and response shaping in one place. Results are
// cached in memory with a TTL and outbound calls are spaced at least one
// second apart, per the public Nominatim usage policy. The cache and clock
// are module-global, which is correct for this single-instance deployment;
// a scaled-out deployment would need a shared cache instead.

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const SEARCH_TTL_MS = 10 * 60 * 1000;
const REVERSE_TTL_MS = 30 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 1000;
const USER_AGENT = "Ecommerce-Storefront/1.0 (address autocomplete)";
const TEMPORARY_ERROR = "Location search is temporarily unavailable.";

const cache = new Map();
let lastUpstreamAt = 0;

export function __resetGeocodeCacheForTests() {
  cache.clear();
  lastUpstreamAt = 0;
}

function cached(key, now) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

async function throttledFetch(url, { fetchImpl, now, sleep }) {
  const elapsed = now() - lastUpstreamAt;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastUpstreamAt = now();
  const res = await fetchImpl(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) {
    const error = new Error(TEMPORARY_ERROR);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

function addressPart(address, keys, fallback = "") {
  for (const key of keys) {
    if (address[key]) return String(address[key]);
  }
  return fallback;
}

function mapResult(row) {
  const address = row.address || {};
  return {
    label: row.display_name || "",
    line1: [address.house_number, address.road].filter(Boolean).join(" "),
    line2: addressPart(address, ["suburb", "neighbourhood", "quarter"]),
    city: addressPart(address, ["city", "town", "village", "municipality"]),
    state: addressPart(address, ["state"]),
    postalCode: addressPart(address, ["postcode"]),
    country: addressPart(address, ["country"], "India"),
    latitude: Number(row.lat),
    longitude: Number(row.lon),
  };
}

export async function searchLocations(query, dependencies = {}) {
  const q = String(query ?? "").trim();
  if (q.length < 3) return [];
  const fetchImpl = dependencies.fetchImpl || fetch;
  const now = dependencies.now || (() => Date.now());
  const sleep = dependencies.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const key = `search:${q.toLowerCase()}`;
  const hit = cached(key, now());
  if (hit) return hit;
  const params = new URLSearchParams({
    format: "jsonv2",
    q,
    countrycodes: "in",
    limit: "5",
    addressdetails: "1",
  });
  const rows = await throttledFetch(`${NOMINATIM_BASE}/search?${params}`, { fetchImpl, now, sleep });
  const results = Array.isArray(rows) ? rows.map(mapResult) : [];
  cache.set(key, { value: results, expiresAt: now() + SEARCH_TTL_MS });
  return results;
}

export async function reverseGeocode({ lat, lng } = {}, dependencies = {}) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const fetchImpl = dependencies.fetchImpl || fetch;
  const now = dependencies.now || (() => Date.now());
  const sleep = dependencies.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const key = `reverse:${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  const hit = cached(key, now());
  if (hit) return hit;
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    zoom: "18",
  });
  const row = await throttledFetch(`${NOMINATIM_BASE}/reverse?${params}`, { fetchImpl, now, sleep });
  const result = row ? mapResult(row) : null;
  cache.set(key, { value: result, expiresAt: now() + REVERSE_TTL_MS });
  return result;
}
