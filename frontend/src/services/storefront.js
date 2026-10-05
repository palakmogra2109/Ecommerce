import { handleUnauthorizedResponse } from "./http";
// Public storefront data layer.
//
// Every network call the storefront makes lives here, so the components stay
// presentational. The storefront is a separate app surface from the admin
// panel: it has its own token key and its own unauthenticated/bearer mix, so
// it does not share the admin's services/* modules beyond the header helper.

const BACKEND_BASE = "/api/store";
const ADMIN_BASE = "/api";

const STORE_TOKEN_KEY = "sf_token";

function getStoreToken() {
  try {
    return localStorage.getItem(STORE_TOKEN_KEY) || null;
  } catch {
    // Storage unavailable (private mode): the session still works in-memory.
    return null;
  }
}

export function setStoreToken(token) {
  try {
    if (token) {
      localStorage.setItem(STORE_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(STORE_TOKEN_KEY);
    }
  } catch {
    // Ignore storage errors.
  }
}

// Same shape as the admin services/http.js authHeaders, reading the storefront's
// own token key. A logged-out shopper sends no header at all, which the
// public catalogue endpoints expect.
function storefrontAuthHeaders(extra = {}) {
  const token = getStoreToken();
  if (!token) return extra;
  return { ...extra, Authorization: `Bearer ${token}` };
}

// Storefront endpoints answer with plain JSON and no envelope, so only the
// HTTP status carries success. Both helpers resolve either way and hand back
// { ok, data } / { ok, blob } so callers never need a try/catch around JSON.
async function storefrontFetch(path, options = {}) {
  const res = await fetch(`${BACKEND_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...storefrontAuthHeaders(),
      ...(options.headers || {}),
    },
  });
  handleUnauthorizedResponse(res);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function storefrontAdminFetch(path, options = {}) {
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...storefrontAuthHeaders(),
      ...(options.headers || {}),
    },
  });
  handleUnauthorizedResponse(res);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export function getStoreProducts({ page = 1, limit = 12, search = "", category = "", branchId = null, pincode = "", lat = null, lng = null } = {}) {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search.trim()) qs.set("search", search.trim());
  if (category) qs.set("category", category);
  if (branchId) qs.set("branchId", branchId);
  if (String(pincode || "").trim()) qs.set("pincode", String(pincode).trim());
  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    qs.set("lat", String(Number(lat)));
    qs.set("lng", String(Number(lng)));
  }
  return storefrontFetch(`/products?${qs}`);
}

export function getStoreProduct(uuid) {
  return storefrontFetch(`/products/${uuid}`);
}

export function getStoreBanners(position = "hero") {
  return storefrontFetch(`/banners?position=${encodeURIComponent(position)}`);
}

export function getStoreBranches({ limit = 100, pincode = "", lat = null, lng = null } = {}) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (String(pincode || "").trim()) qs.set("pincode", String(pincode).trim());
  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    qs.set("lat", String(Number(lat)));
    qs.set("lng", String(Number(lng)));
  }
  return storefrontFetch(`/branches?${qs}`);
}

export function placeStoreOrder(payload) {
  // The checkout handler lives at /api/orders/store (admin base path).
  // There is no /api/store/orders/store route, so the old path answered
  // with Next's 404 page on every checkout.
  return storefrontAdminFetch("/orders/store", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getMyOrders({ page = 1, limit = 10 } = {}) {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  return storefrontFetch(`/orders/mine?${qs}`);
}

export function trackStoreOrder(orderNumber, email) {
  const qs = new URLSearchParams({
    order_number: orderNumber.trim(),
    email: email.trim().toLowerCase(),
  });
  return storefrontFetch(`/orders/track?${qs}`);
}

// Bills are served as a binary PDF, so this returns a Blob rather than JSON.
export async function downloadOrderInvoice(orderNumber, email) {
  const qs = new URLSearchParams({
    order_number: orderNumber.trim(),
    email: email.trim().toLowerCase(),
  });
  const res = await fetch(`${BACKEND_BASE}/orders/track/invoice?${qs}`, {
    credentials: "include",
    headers: storefrontAuthHeaders(),
  });
  if (!res.ok) throw new Error("Could not download the bill");
  return res.blob();
}

export function storeLogin(email, password) {
  return storefrontAdminFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function requestOtp(mobile) {
  return storefrontFetch("/otp/request", {
    method: "POST",
    body: JSON.stringify({ mobile }),
  });
}

export function verifyOtp(mobile, otp) {
  return storefrontFetch("/otp/verify", {
    method: "POST",
    body: JSON.stringify({ mobile, otp }),
  });
}

export function quoteCheckout({
  subtotal,
  couponCode = "",
  giftCardCode = "",
  customerEmail = "",
  useGiftCard = false,
  customerId = null,
}) {
  return storefrontFetch("/checkout/quote", {
    method: "POST",
    body: JSON.stringify({ subtotal, couponCode, giftCardCode, customerEmail, useGiftCard, customerId }),
  });
}

// The shopper's gift balance as one figure, with the cards behind it.
export function getWallet() {
  return storefrontFetch("/wallet");
}

// What a gift card code is worth, before the shopper commits to it.
//
// Read-only on the server: no wallet is opened, no value moves, and the code is
// never echoed back — so it is safe to call on every keystroke, which is why the
// wallet panel debounces it rather than waiting for a button.
export function previewGiftCardCode(code) {
  return storefrontFetch("/gift-cards/claim/preview", {
    method: "POST",
    body: JSON.stringify({ code: String(code || "") }),
  });
}

// Turns a code into wallet money.
//
// On a refusal the server's `message` is the answer to show, verbatim: it tells
// "no such code" apart from "already claimed" and from "expired" on purpose, and
// a friendlier paraphrase thrown over the top would throw that away. A 429 means
// the guess budget is spent, and the caller must not retry on its own.
export function claimGiftCardCode(code) {
  return storefrontFetch("/gift-cards/claim", {
    method: "POST",
    body: JSON.stringify({ code: String(code || "") }),
  });
}

// The E-Cards shelf. Public, so it renders before login.
export function getDenominations() {
  return storefrontFetch("/gift-cards/denominations");
}

// Buy a gift card for someone else. sendLater + scheduledFor queues the
// intent instead of issuing immediately.
export function purchaseGiftCard(payload) {
  return storefrontFetch("/gift-cards/purchase", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getStoreProfile() {
  return storefrontFetch("/profile");
}

export function updateStoreProfile(patch) {
  return storefrontFetch("/profile", {
    method: "PATCH",
    body: JSON.stringify(patch || {}),
  });
}

export function getAddresses() {
  return storefrontFetch("/addresses");
}

export function createAddress(payload) {
  return storefrontFetch("/addresses", { method: "POST", body: JSON.stringify(payload || {}) });
}

export function claimAddresses(payload) {
  return storefrontFetch("/addresses", { method: "POST", body: JSON.stringify({ claim: payload || [] }) });
}

export function updateAddress(id, patch) {
  return storefrontFetch("/addresses", { method: "PATCH", body: JSON.stringify({ ...(patch || {}), id }) });
}

export function deleteAddress(id) {
  return storefrontFetch("/addresses", { method: "DELETE", body: JSON.stringify({ id }) });
}

export function geocodeSearch(q) {
  const qs = new URLSearchParams({ q: String(q || "").trim() });
  return storefrontFetch(`/geocode/search?${qs}`);
}

export function geocodeReverse({ lat, lng }) {
  const qs = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  return storefrontFetch(`/geocode/reverse?${qs}`);
}

// ---------------------------------------------------------------- formatting

export const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

// Coerce anything (stale localStorage carts may hold objects) to safe text.
export const asText = (v) => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && v.name != null) return String(v.name);
  return "";
};

// A cart line is identified by product AND variant: the same product bought in
// two variants is two lines. Without the variant in the key, adding a second
// variant merged into the first and one stepper drove both.
export const cartLineId = (uuid, variantName) => `${uuid}::${variantName || ""}`;

// Repair cart lines persisted by older builds (e.g. _variant stored as an
// object rendered as "[object Object]"). Runs on every load.
export function sanitizeCartLine(l) {
  if (!l || typeof l !== "object" || !l.uuid) return null;
  const variant = asText(l._variant) || null;
  return {
    ...l,
    lineId: cartLineId(l.uuid, variant),
    name: asText(l.name) || "Product",
    _variant: variant,
    _variantSku: asText(l._variantSku) || null,
    price: Number(l.price) || 0,
    quantity: Math.max(1, Number(l.quantity) || 1),
  };
}

// ------------------------------------------------------------------- pricing

// The API exposes price as `discount_price` and sometimes camelCase, and
// effectivePrice / effectiveCompareAtPrice when a branch is selected. Reading
// them by hand at each call site produced subtly different results between the
// card, the detail page, the cart and the checkout summary.
export const discountOf = (o) => {
  if (o == null) return null;
  const d = o.discount_price ?? o.discountPrice;
  return d == null ? null : Number(d);
};

export const isDiscounted = (discount, base) =>
  discount != null && Number(discount) > 0 && Number(discount) < Number(base);

// Price shown on a product card. Branch-specific pricing wins outright, then a
// product-level discount, then the best-ratio discounted variant.
export function resolveDisplayPrice(p) {
  const base = Number(p.price) || 0;
  const branchPrice =
    p.effectivePrice != null && Number(p.effectivePrice) > 0 ? Number(p.effectivePrice) : null;

  if (branchPrice != null) {
    const compare = p.effectiveCompareAtPrice != null ? Number(p.effectiveCompareAtPrice) : null;
    return {
      price: branchPrice,
      mrp: compare != null && compare > branchPrice ? compare : base,
    };
  }

  const productDiscount = discountOf(p);
  if (isDiscounted(productDiscount, base)) {
    return { price: Number(productDiscount), mrp: base };
  }

  const variants = Array.isArray(p.variants) ? p.variants : [];
  const best = variants
    .filter((v) => isDiscounted(discountOf(v), v.price))
    .reduce(
      (a, b) => (!a ? b : discountOf(a) / Number(a.price) < discountOf(b) / Number(b.price) ? a : b),
      null,
    );
  if (best) {
    return { price: Number(discountOf(best)), mrp: Number(best.price) };
  }

  return { price: base, mrp: base };
}

// Price actually charged for one cart line, after any discount.
export const linePrice = (l) => {
  const d = discountOf(l);
  return isDiscounted(d, l.price) ? Number(d) : Number(l.price || 0);
};

export const discountPercent = (discount, base) =>
  Number(base) > 0 ? Math.round((1 - Number(discount) / Number(base)) * 100) : 0;

// ------------------------------------------------------------------ constants

export const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><rect width='400' height='400' fill='#eef2f7'/><text x='50%' y='50%' fill='#94a3b8' font-family='sans-serif' font-size='18' text-anchor='middle'>ShopCart</text></svg>`,
  );

export const ORDER_STEPS = ["PLACED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"];

export const STEP_LABELS = {
  PLACED: "Placed",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
};

export const PAYMENT_METHODS = [
  { id: "cod", label: "Cash on Delivery", hint: "Pay when your order arrives" },
  { id: "stripe_sandbox", label: "Card (sandbox)", hint: "Demo card — no real charge" },
  { id: "paypal_sandbox", label: "PayPal (sandbox)", hint: "Demo checkout — no real charge" },
];

// Cached by the caller (BannerCarousel) rather than refetched per render.
export const bannerIsLive = (bn, nowMs = Date.now()) => {
  if (bn.starts_at && new Date(bn.starts_at).getTime() > nowMs) return false;
  if (bn.ends_at && new Date(bn.ends_at).getTime() <= nowMs) return false;
  return true;
};

export function bannerTimeLeft(endsAt) {
  const leftMs = new Date(endsAt).getTime() - Date.now();
  if (leftMs <= 0) return null;
  const days = Math.floor(leftMs / 86400000);
  const hrs = Math.floor((leftMs % 86400000) / 3600000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"} left`;
  if (hrs >= 1) return `${hrs} hr${hrs === 1 ? "" : "s"} left`;
  return "Ends soon";
}
