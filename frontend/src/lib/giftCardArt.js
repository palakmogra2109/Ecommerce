/**
 * Gift card art, generated as an SVG data URI.
 *
 * There is no image provider connected, and faking one would be worse than
 * having none: a grey placeholder reads as broken, whereas generated art reads
 * as designed. This needs no network, no key and no storage — the same label
 * always produces the same artwork, so a card looks identical everywhere it
 * appears.
 *
 * If a real image URL is supplied it is used instead.
 */

// Hand-picked pairs that stay legible with white text on top.
const PALETTES = [
  ["#15803d", "#22c55e"],
  ["#0369a1", "#0ea5e9"],
  ["#7e22ce", "#a855f7"],
  ["#b45309", "#f59e0b"],
  ["#be123c", "#f43f5e"],
  ["#0f766e", "#14b8a6"],
  ["#4338ca", "#6366f1"],
  ["#9d174d", "#db2777"],
];

// Small deterministic hash so a given label always lands on the same palette.
function hash(text) {
  let h = 2166136261;
  const s = String(text || "gift");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatRupees(amount) {
  const n = Number(amount) || 0;
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function initials(label) {
  return String(label || "G")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/**
 * @param {object} opts
 * @param {string} [opts.label]  Card label, drives the palette and monogram.
 * @param {number} [opts.amount] Face value, shown large.
 * @param {string} [opts.scope]  Short scope text, e.g. "Spices & Masalas".
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @returns {string} data URI usable as an <img src>
 */
export function giftCardArtSvg({ label = "Gift Card", amount = 0, scope = "", width = 480, height = 300 } = {}) {
  const seed = hash(`${label}|${scope}`);
  const [from, to] = PALETTES[seed % PALETTES.length];
  const angle = seed % 90;
  const gid = `g${seed % 100000}`;

  const scopeText = scope ? String(scope).slice(0, 34) : "";
  // Long scopes are shrunk rather than clipped, so nothing is ever cut off.
  const scopeSize = scopeText.length > 22 ? 17 : scopeText.length > 15 ? 20 : 23;

  // Every container that shows this art is wider than 1.6:1 (the wallet,
  // admin preview and shelf all crop the top and bottom with object-fit:
  // cover). The widest, the shelf at ~2.27:1, clips 44px from each side, so
  // all content lives inside y=50..250 and is never cut off. The decorative
  // circles and background extend past that band on purpose — cropping them
  // is what makes the gradient fill the box.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(`${label} ${formatRupees(amount)}`)}">
  <defs>
    <linearGradient id="${gid}" gradientTransform="rotate(${angle})">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#${gid})"/>
  <circle cx="${width - 46}" cy="34" r="118" fill="#ffffff" opacity="0.10"/>
  <circle cx="${width - 96}" cy="${height + 26}" r="86" fill="#ffffff" opacity="0.08"/>
  <text x="30" y="74" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="22" font-weight="700" fill="#ffffff">${escapeXml(String(label).slice(0, 26))}</text>
  <text x="30" y="158" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="64" font-weight="800" fill="#ffffff" letter-spacing="-2">${escapeXml(formatRupees(amount))}</text>
  ${scopeText ? `<text x="30" y="200" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="${scopeSize}" font-weight="600" fill="#ffffff" opacity="0.88">${escapeXml(scopeText)}</text>` : ""}
  <g opacity="0.9">
    <rect x="30" y="222" width="188" height="26" rx="13" fill="#000000" opacity="0.16"/>
    <text x="44" y="240" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="14" font-weight="700" fill="#ffffff" letter-spacing="0.4">${escapeXml(initials(label))}</text>
  </g>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// A card's art: a real image when one was supplied, otherwise generated.
export function giftCardImage({ imageUrl, label, amount, scope } = {}) {
  const url = String(imageUrl || "").trim();
  return url || giftCardArtSvg({ label, amount, scope });
}

// Short human summary of what a card is limited to, for chips and tooltips.
export function scopeSummary({ applicableBrands, applicableCategories, applicableProducts, brandNames = {}, categoryNames = {} } = {}) {
  const parts = [];
  const brands = applicableBrands || [];
  const categories = applicableCategories || [];
  const products = applicableProducts || [];

  if (brands.length) {
    parts.push(brands.map((b) => brandNames[b] || `#${b}`).join(", "));
  }
  if (categories.length) {
    parts.push(categories.map((c) => categoryNames[c] || c).join(", "));
  }
  if (products.length) {
    parts.push(`${products.length} selected ${products.length === 1 ? "item" : "items"}`);
  }

  if (parts.length === 0) return "Any product";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, 2).join(" · ")}${parts.length > 2 ? " · …" : ""}`;
}
