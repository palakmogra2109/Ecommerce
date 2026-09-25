import { useEffect, useState } from "react";
import {
  FiHome, FiShoppingCart, FiTruck, FiUser, FiSearch,
  FiChevronLeft, FiChevronRight, FiPlus, FiMinus, FiTrash2,
  FiShield, FiCreditCard, FiRefreshCw, FiStar, FiMapPin, FiShoppingBag,
  FiArrowRight, FiChevronDown, FiClock, FiPhoneCall, FiMail, FiCheckCircle,
} from "react-icons/fi";

const BACKEND_BASE = "/api/store";
const ADMIN_BASE = "/api";

async function api(path, options = {}) {
  const res = await fetch(`${BACKEND_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function adminApi(path, options = {}) {
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  return data;
}

const VIEWS = { CATALOG: 1, DETAIL: 2, CART: 3, CHECKOUT: 4, TRACK: 5, ACCOUNT: 6 };

const PH =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><rect width='400' height='400' fill='#eef2f7'/><text x='50%' y='50%' fill='#94a3b8' font-family='sans-serif' font-size='18' text-anchor='middle'>ShopCart</text></svg>`
  );

const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

// Coerce anything (stale localStorage carts may hold objects) to safe text.
const asText = (v) => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && v.name != null) return String(v.name);
  return "";
};

// Repair cart lines persisted by older builds (e.g. _variant stored as an
// object rendered as "[object Object]"). Runs on every load.
function sanitizeCartLine(l) {
  if (!l || typeof l !== "object" || !l.uuid) return null;
  return {
    ...l,
    name: asText(l.name) || "Product",
    _variant: asText(l._variant) || null,
    _variantSku: asText(l._variantSku) || null,
    price: Number(l.price) || 0,
    quantity: Math.max(1, Number(l.quantity) || 1),
  };
}

function Stars({ rating, reviews }) {
  const r = Math.round(Number(rating) || 0);
  if (!Number(reviews)) return null;
  return (
    <div className="sf-stars">
      <span className="sf-stars-row">
        {[1, 2, 3, 4, 5].map((i) => (
          <FiStar key={i} className={i <= r ? "on" : "off"} />
        ))}
      </span>
      <span>{Number(rating).toFixed(1)}</span>
      <span className="muted">({reviews})</span>
    </div>
  );
}

export default function Storefront() {
  const [error, setError] = useState("");
  const [view, setView] = useState(VIEWS.CATALOG);
  const [products, setProducts] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState(null);
  const [cart, setCart] = useState(() => {
    try {
      const raw = localStorage.getItem("sf_cart");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.map(sanitizeCartLine).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  });
  const [selectedBranch, setSelectedBranch] = useState(() => {
    try { return localStorage.getItem("sf_branch") ? JSON.parse(localStorage.getItem("sf_branch")) : null; } catch { return null; }
  });
  const [branchList, setBranchList] = useState([]);
  const [showBranchSelector, setShowBranchSelector] = useState(false);
  const [toast, setToast] = useState(null);
  const [placedOrder, setPlacedOrder] = useState(null);

  useEffect(() => {
    localStorage.setItem("sf_cart", JSON.stringify(cart));
  }, [cart]);

  function notify(msg) {
    setToast(msg);
    clearTimeout(notify._t);
    notify._t = setTimeout(() => setToast(null), 2600);
  }

  async function loadProducts() {
    setLoading(true);
    setError("");
    const qs = new URLSearchParams({ page, limit: 12 });
    if (search.trim()) qs.set("search", search.trim());
    if (category) qs.set("category", category);
    if (selectedBranch) qs.set("branchId", selectedBranch.uuid);
    const { ok, data } = await api(`/products?${qs}`);
    if (!ok) {
      setError(data.message || "Could not load products");
    } else {
      setProducts(data.products || []);
      setPagination(data.pagination || { total: 0, pages: 1 });
    }
    setLoading(false);
  }

  useEffect(() => {
    loadProducts();
  }, [page, category]);

  // Load branch list when selector is shown
  async function loadBranches() {
    try {
      const res = await fetch(`${ADMIN_BASE}/branches?limit=100`, { credentials: "include" });
      const data = await res.json();
      if (data.success) setBranchList(data.branches || []);
    } catch {}
  }

  function handleBranchSelect(branch) {
    setSelectedBranch(branch);
    localStorage.setItem("sf_branch", JSON.stringify(branch));
    setShowBranchSelector(false);
    setPage(1);
    loadProducts();
  }

  useEffect(() => {
    loadProducts();
  }, [selectedBranch]);

  function goCatalog() {
    setView(VIEWS.CATALOG);
    setCurrent(null);
    setPage(1);
    setSearch("");
  }

  function addToCart(product, quantity = 1, variant = null) {
    const q = Math.max(1, parseInt(quantity, 10) || 1);
    const variantName = variant?.name != null ? asText(variant.name) : null;
    const variantPrice = variant?.price != null ? Number(variant.price) : Number(product.price);
    const variantStock = variant?.stock ?? product.stock;
    const variantDiscount = (variant?.discount_price ?? variant?.discountPrice) != null
      ? Number((variant?.discount_price ?? variant?.discountPrice) ?? 0)
      : Number((product.discount_price ?? product.discountPrice) || 0);
    const hasDiscount = variantDiscount > 0 && variantDiscount < variantPrice;
    const effectivePrice = hasDiscount ? variantDiscount : variantPrice;
    setCart((prev) => {
      const line = prev.find(
        (i) => i.uuid === product.uuid && i._variant === variantName
      );
      if (line) {
        return prev.map((i) =>
          i.uuid === product.uuid && i._variant === variantName
            ? { ...i, quantity: Math.min(i.quantity + q, variantStock || 99) }
            : i
        );
      }
      return [
        ...prev,
        {
          ...product,
          quantity: Math.min(q, variantStock || 99),
          price: effectivePrice,
          discount_price: hasDiscount ? variantDiscount : (product.discount_price ?? product.discountPrice),
          _variant: variantName,
          _variantSku: variant?.sku || product.sku,
        },
      ];
    });
    const vLabel = variantName ? ` (${variantName})` : "";
    notify(`"${product.name}${vLabel}" added to cart`);
  }

  function updateQty(uuid, q) {
    setCart((prev) =>
      prev
        .map((i) => (i.uuid === uuid ? { ...i, quantity: Math.max(0, q) } : i))
        .filter((i) => i.quantity > 0)
    );
  }

  const cartCount = cart.reduce((s, i) => s + Number(i.quantity || 0), 0);
  const cartTotal = cart.reduce(
    (s, i) =>
      s +
      Number(i.quantity || 0) *
        (Number((i.discount_price ?? i.discountPrice) != null && Number((i.discount_price ?? i.discountPrice)) > 0 ? (i.discount_price ?? i.discountPrice) : i.price) || 0),
    0
  );

  const subViews = {
    [VIEWS.DETAIL]: current && (
      <ProductDetail
        product={current}
        onAdd={addToCart}
        onBack={() => setView(VIEWS.CATALOG)}
        onBuy={(p, q, variant) => {
          addToCart(p, q, variant);
          setView(VIEWS.CHECKOUT);
        }}
      />
    ),
    [VIEWS.CART]: (
      <CartView
        lines={cart}
        onBack={() => setView(VIEWS.CATALOG)}
        onUpdate={updateQty}
        onRemove={(uuid) => updateQty(uuid, 0)}
        onCheckout={() => setView(VIEWS.CHECKOUT)}
        onShop={goCatalog}
        total={cartTotal}
        count={cartCount}
      />
    ),
    [VIEWS.CHECKOUT]: (
      <CheckoutForm
        lines={cart}
        subtotal={cartTotal}
        selectedBranch={selectedBranch}
        onDone={(order) => {
          setPlacedOrder(order);
          setCart([]);
          setView(VIEWS.TRACK);
        }}
        onBack={() => setView(VIEWS.CART)}
      />
    ),
    [VIEWS.TRACK]: <OrderTrack prefilledOrder={placedOrder} onBack={goCatalog} />,
    [VIEWS.ACCOUNT]: <AccountPanel onBack={goCatalog} />,
  };

  const showBanner = view === VIEWS.CATALOG;

  return (
    <div className="sf-root">
      <style>{CSS}</style>

      <div className="sf-announce">
        <span className="sf-announce-in">
          <span className="sf-announce-item"><FiTruck /> Free delivery on orders above ₹499</span>
          <span className="sf-announce-dot" />
          <span className="sf-announce-item">Cash on Delivery available</span>
          <span className="sf-announce-dot" />
          <span className="sf-announce-item">Easy 7-day returns</span>
        </span>
      </div>

      <header className="sf-top">
        <div className="sf-top-in">
          <button className="sf-brand" onClick={goCatalog}>
            <span className="sf-logo"><FiHome /></span>
            <span>Earth<em>धान्य</em></span>
          </button>
          <nav className="sf-nav">
            <button className={view === VIEWS.TRACK ? "on" : ""} onClick={() => setView(VIEWS.TRACK)}>
              <FiTruck /> Track
            </button>
            <button className={view === VIEWS.ACCOUNT ? "on" : ""} onClick={() => setView(VIEWS.ACCOUNT)}>
              <FiUser /> Account
            </button>
          </nav>
          <div className="sf-spacer" />
          <button className="sf-cart-btn" onClick={() => setView(VIEWS.CART)}>
            <FiShoppingCart />
            <span>Cart</span>
            {cartCount > 0 && <b>{cartCount}</b>}
          </button>
          <div className="sf-branch-wrap">
            <button className="sf-branch-btn" onClick={() => { loadBranches(); setShowBranchSelector(!showBranchSelector); }}>
              <FiShoppingBag />
              <span className="sf-branch-txt">
                <small>Deliver from</small>
                <strong>{selectedBranch ? selectedBranch.name : "Select Store"}</strong>
              </span>
              <FiChevronDown />
            </button>
            {showBranchSelector && (
              <div className="sf-branch-dropdown">
                <div className="sf-branch-head">Choose your store</div>
                <button className="sf-branch-option" onClick={() => { setSelectedBranch(null); localStorage.removeItem("sf_branch"); setShowBranchSelector(false); setPage(1); loadProducts(); }}>
                  <strong>All Stores</strong>
                  <span>Browse the full catalogue</span>
                </button>
                {branchList.map((b) => (
                  <button key={b.uuid} className={`sf-branch-option${selectedBranch?.uuid === b.uuid ? " on" : ""}`} onClick={() => handleBranchSelect(b)}>
                    <strong>{b.name}{b.code ? <em className="sf-branch-code">{b.code}</em> : ""}</strong>
                    <span>{b.city || "—"}</span>
                  </button>
                ))}
                {branchList.length === 0 && (
                  <div className="sf-branch-none">No stores available right now</div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="sf-body">
        {toast && <div className="sf-toast">{toast}</div>}

        {view === VIEWS.CATALOG && (
          <>
            <section className="sf-hero">
              <div className="sf-hero-bg" aria-hidden="true" />
              <div className="sf-hero-in">
                <span className="sf-hero-kicker"><FiMapPin /> Fresh groceries from stores near you</span>
                <h1>Farm-fresh essentials,<br />delivered to your door.</h1>
                <p>Grains, oils, spices &amp; more — picked from your neighbourhood store, at honest prices.</p>
                <div className="sf-hero-search">
                  <FiSearch />
                  <input
                    placeholder="Search for grains, oils, spices…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setPage(1);
                        loadProducts();
                      }
                    }}
                  />
 <button className="sf-btn primary sf-hero-go" onClick={() => { setPage(1); loadProducts(); }}>Search</button>
                </div>
                <div className="sf-hero-tags">
                  <button onClick={() => { setSearch("Rice"); setPage(1); loadProducts(); }}>Rice</button>
                  <button onClick={() => { setSearch("Oil"); setPage(1); loadProducts(); }}>Oil</button>
                  <button onClick={() => { setSearch("Wheat"); setPage(1); loadProducts(); }}>Wheat</button>
                  <button onClick={() => { setSearch("Spices"); setPage(1); loadProducts(); }}>Spices</button>
                </div>
              </div>
            </section>

            {showBanner && <BannerCarousel />}

            <div className="sf-trust">
              <span><FiTruck /> Fast delivery</span>
              <span><FiShield /> Secure checkout</span>
              <span><FiRefreshCw /> Easy returns</span>
              <span><FiCreditCard /> COD &amp; cards</span>
            </div>

            {!loading && products.length > 0 && (
              <div className="sf-cats">
                <button className={!category ? "on" : ""} onClick={() => setCategory("")}>
                  All
                </button>
                {[
                  ...new Map(
                    products.map((p) => [p.category_slug, p.category_name])
                  ),
                ].map(([slug, name]) => (
                  <button
                    key={slug || name}
                    className={category === slug ? "on" : ""}
                    onClick={() => {
                      setCategory(slug || "");
                      setPage(1);
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}

            {error && <div className="sf-err">{error}</div>}

            {loading ? (
              <div className="sf-grid">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div className="sf-card sf-skeleton" key={i}>
                    <div className="sk-img" />
                    <div className="sf-card-body">
                      <div className="sk sk-l" />
                      <div className="sk sk-m" />
                      <div className="sk sk-s" />
                    </div>
                  </div>
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="sf-empty">
                <FiSearch size={34} />
                <p>No products found.</p>
                <button
                  className="sf-btn primary"
                  onClick={() => {
                    setSearch("");
                    setCategory("");
                    setPage(1);
                    loadProducts();
                  }}
                >
                  View all products
                </button>
              </div>
            ) : (
              <>
                <div className="sf-section-head">
                  <div>
                    <h2>{category ? "Filtered picks" : search ? "Search results" : "Trending now"}</h2>
                    <p>
                      {pagination.total} item{pagination.total === 1 ? "" : "s"}
                      {selectedBranch ? ` · ${selectedBranch.name}` : " · across all stores"}
                    </p>
                  </div>
                  {pagination.pages > 1 && (
                    <span className="sf-section-page">Page {page} of {pagination.pages}</span>
                  )}
                </div>
                <div className="sf-grid">
                  {products.map((p) => (
                    <ProductCard
                      key={p.uuid}
                      p={p}
                      onOpen={() => {
                        setCurrent(p);
                        setView(VIEWS.DETAIL);
                      }}
                      onAdd={() => addToCart(p)}
                    />
                  ))}
                </div>

                {pagination.pages > 1 && (
                  <div className="sf-pager">
                    <button
                      className="sf-btn"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <FiChevronLeft />
                    </button>
                    {Array.from({ length: pagination.pages }, (_, i) => i + 1)
                      .filter(
                        (n) =>
                          n === 1 ||
                          n === pagination.pages ||
                          Math.abs(n - page) <= 2
                      )
                      .map((n, idx, arr) => (
                        <span key={n} className="sf-pager-pos">
                          {idx > 0 && n - arr[idx - 1] > 1 && (
                            <span className="sf-ellipsis">…</span>
                          )}
                          <button
                            className={`sf-page ${n === page ? "active" : ""}`}
                            onClick={() => setPage(n)}
                          >
                            {n}
                          </button>
                        </span>
                      ))}
                    <button
                      className="sf-btn"
                      disabled={page >= pagination.pages}
                      onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
                    >
                      <FiChevronRight />
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {subViews[view]}
      </main>

      <footer className="sf-footer">
        <div className="sf-footer-grid">
          <div className="sf-footer-col">
            <b className="sf-footer-brand">Earth<em>धान्य</em></b>
            <p>Farm-fresh essentials for every Indian kitchen. Honest prices, doorstep delivery.</p>
            <div className="sf-footer-usp">
              <span><FiCheckCircle /> 100% quality-checked</span>
              <span><FiCheckCircle /> Transparent pricing</span>
            </div>
          </div>
          <div className="sf-footer-col">
            <b>Shop</b>
            <button onClick={goCatalog}>All products</button>
            <button onClick={() => setView(VIEWS.TRACK)}>Track order</button>
            <button onClick={() => setView(VIEWS.ACCOUNT)}>My account</button>
          </div>
          <div className="sf-footer-col">
            <b>Support</b>
            <span><FiMail /> orders@earthdhanya.in</span>
            <span><FiPhoneCall /> +91 98765 43210</span>
            <span><FiClock /> Mon–Sat, 9am–7pm</span>
          </div>
        </div>
        <div className="sf-footer-b">
          © {new Date().getFullYear()} Earth धान्य · All rights reserved
        </div>
      </footer>
    </div>
  );
}

function ProductCard({ p, onOpen, onAdd }) {
  const variants = Array.isArray(p.variants) && p.variants.length > 0 ? p.variants : [];

  // Branch-specific pricing takes priority when branch is selected
  const branchPrice = p.effectivePrice != null && Number(p.effectivePrice) > 0 ? Number(p.effectivePrice) : null;
  const branchCompare = p.effectiveCompareAtPrice != null ? Number(p.effectiveCompareAtPrice) : null;

  const productDisc = p.discount_price ?? p.discountPrice;
  const productUseDisc = productDisc != null && Number(productDisc) > 0;
  const discountVariants = variants.filter((v) => {
    const d = v.discount_price ?? v.discountPrice;
    return d != null && Number(d) > 0 && Number(d) < Number(v.price);
  });

  let mrp = Number(p.price) || 0;
  let price = Number(p.price) || 0;

  if (branchPrice != null) {
    price = branchPrice;
    mrp = branchCompare != null && branchCompare > branchPrice ? branchCompare : (Number(p.price) || 0);
  } else if (productUseDisc) {
    mrp = Number(p.price) || 0;
    price = Number(productDisc);
  } else if (discountVariants.length > 0) {
    const best = discountVariants.reduce((a, b) =>
      (Number(a.discount_price ?? a.discountPrice) / Number(a.price)) <
        (Number(b.discount_price ?? b.discountPrice) / Number(b.price))
        ? a : b
    );
    mrp = Number(best.price);
    price = Number(best.discount_price ?? best.discountPrice);
  }

  const useDisc = mrp > 0 && price < mrp;
  const off = useDisc && Number(mrp) > 0
    ? Math.round((1 - price / mrp) * 100)
    : 0;
  const out = p.stock <= 0;
  const img = p.images && p.images[0] ? p.images[0] : PH;
  const variantLabels = variants.map((v) => v.name);

  return (
    <div className="sf-card" onClick={() => onOpen()}>
      <div className="sf-card-img">
        <img src={img} alt={p.name} loading="lazy" />
        {off > 0 && <span className="sf-badge-off">{off}% OFF</span>}
        {p.featured && <span className="sf-badge-feat">★ Featured</span>}
        {out && <div className="sf-cover">Out of stock</div>}
      </div>
      <div className="sf-card-body">
        <div className="sf-cat">{p.category_name}</div>
        <div className="sf-name" title={p.name}>{p.name}</div>
        <Stars rating={p.rating} reviews={p.review_count} />
        {variantLabels.length > 0 && (
          <div className="sf-variants-preview">
            {variantLabels.slice(0, 3).map((v, i) => (
              <span key={i} className="sf-variant-chip">{v}</span>
            ))}
            {variants.length > 3 && (
              <span className="sf-variant-chip more">+{variants.length - 3}</span>
            )}
          </div>
        )}
        <div className="sf-card-foot">
          <div className="sf-price">
            <span className="sf-now">{inr(price)}</span>
            {useDisc && <span className="sf-was">{inr(mrp)}</span>}
          </div>
          <button
            className="sf-add-btn"
            disabled={out}
            title={out ? "Out of stock" : "Add to cart"}
            onClick={() => onAdd(p, 1, variants[0] || null)}
          >
            <FiPlus />
          </button>
        </div>
        <div className={out ? "sf-stock low" : "sf-stock ok"}>
          {out ? "Out of stock" : variants.length > 0 ? `${variants.length} options` : p.stock <= 5 ? `Only ${p.stock} left` : `In stock`}
        </div>
      </div>
    </div>
  );
}

function BannerCarousel() {
  const [banners, setBanners] = useState([]);
  const [idx, setIdx] = useState(0);
  const [now, setNow] = useState(Date.now());

  // Re-check the moment whenever a banner's end time passes while the page
  // stays open, so an expired banner disappears without a reload.
  const longer = banners.reduce(
    (m, bn) => {
      if (!bn.ends_at) return m;
      const t = new Date(bn.ends_at).getTime();
      return m.endsAt && m.endsAt < t ? m : { endsAt: t, uuid: bn.uuid };
    },
    { endsAt: null, uuid: null }
  );

  useEffect(() => {
    if (!longer.endsAt) return;
    const inMs = Math.max(0, longer.endsAt - Date.now());
    const t = setTimeout(() => setNow(Date.now()), Math.min(inMs + 100, 0x7fffffff));
    return () => clearTimeout(t);
  }, [longer.endsAt, longer.uuid, now]);

  useEffect(() => {
    api("/banners?position=hero").then(({ ok, data }) => {
      if (ok) setBanners(data.banners || []);
    });
  }, []);

  useEffect(() => {
    if (banners.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % banners.length), 4500);
    return () => clearInterval(t);
  }, [banners.length]);

  // Client-side guard as well as the server's: a banner is only shown while it
  // is scheduled (starts_at past, ends_at not expired). This also culls
  // anything whose expiry passes while the carousel is on screen.
  const live = banners.filter((bn) => {
    const nowMs = Date.now();
    if (bn.starts_at && new Date(bn.starts_at).getTime() > nowMs) return false;
    if (bn.ends_at && new Date(bn.ends_at).getTime() <= nowMs) return false;
    return true;
  });

  useEffect(() => {
    if (idx >= live.length) setIdx(0);
  }, [live.length]);

  if (live.length === 0) return null;
  const b = live[idx % live.length];

  let expiry = null;
  if (b.ends_at) {
    const leftMs = new Date(b.ends_at).getTime() - Date.now();
    if (leftMs > 0) {
      const leftDays = Math.floor(leftMs / 86400000);
      const leftHrs = Math.floor((leftMs % 86400000) / 3600000);
      expiry =
        leftDays >= 1
          ? `${leftDays} day${leftDays === 1 ? "" : "s"} left`
          : leftHrs >= 1
            ? `${leftHrs} hr${leftHrs === 1 ? "" : "s"} left`
            : "Ends soon";
    }
  }

  return (
    <div
      className="sf-banner"
      onClick={() => b.link && window.open(b.link, "_blank")}
    >
      <img src={b.image || PH} alt={b.title} />
      {!b.link && <div className="sf-banner-veil" />}
      <div className="sf-banner-text">
        <h2>{b.title}</h2>
        {b.subtitle && <p>{b.subtitle}</p>}
        {b.link && <span className="sf-banner-cta">Shop now →</span>}
        {expiry && <em className="sf-banner-expiry">{expiry}</em>}
      </div>
      {banners.length > 1 && (
        <div className="sf-banner-dots">
          {banners.map((_, i) => (
            <span
              key={i}
              className={i === idx ? "on" : ""}
              onClick={(e) => {
                e.stopPropagation();
                setIdx(i);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductDetail({ product: initial, onAdd, onBack, onBuy }) {
  const [p, setP] = useState(initial);
  const [qty, setQty] = useState(1);
  const [activeImg, setActiveImg] = useState(0);
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(-1);
  const variants =
    Array.isArray(p.variants) && p.variants.length > 0 ? p.variants : [];

  useEffect(() => {
    let live = true;
    api(`/products/${initial.uuid}`).then(({ ok, data }) => {
      if (live && ok && data.product) setP({ ...initial, ...data.product });
    });
    return () => {
      live = false;
    };
  }, [initial.uuid]);

  // Reset variant selection when product data changes
  useEffect(() => {
    setSelectedVariantIdx(-1);
  }, [p.uuid]);

  const hasVariants = variants.length > 0;
  const activeVariant = hasVariants ? variants[selectedVariantIdx] || variants[0] : null;
  const variantBasePrice = activeVariant?.price != null ? Number(activeVariant.price) : Number(p.price);
  const variantDiscount = (activeVariant?.discount_price ?? activeVariant?.discountPrice) != null
    ? Number((activeVariant?.discount_price ?? activeVariant?.discountPrice) ?? 0)
    : Number(p.discount_price || 0);
  const hasDiscount = variantDiscount > 0 && variantDiscount < variantBasePrice;
  const price = hasDiscount ? variantDiscount : variantBasePrice;
  const variantStock = activeVariant?.stock ?? Number(p.stock);
  const off = hasDiscount
    ? Math.round((1 - variantDiscount / variantBasePrice) * 100)
    : 0;
  const out = variantStock <= 0;
  const images = p.images && p.images.length ? p.images : [null];
  const hasSpecs =
    p.attributes && typeof p.attributes === "object" && Object.keys(p.attributes).length > 0;

  function handleAdd() {
    onAdd(p, qty, activeVariant);
  }

  function handleBuy() {
    onBuy(p, qty, activeVariant);
  }

  return (
    <div>
      <div className="sf-breadcrumb">
        <button onClick={onBack}>Shop</button>
        {p.category_name && <><span>/</span><span>{p.category_name}</span></>}
        <span>/</span>
        <b>{p.name}</b>
      </div>

      <div className="sf-detail">
        <div className="sf-gallery">
          <img src={images[activeImg] || PH} alt={p.name} />
          {images.length > 1 && (
            <div className="sf-thumbs">
              {images.map((img, i) => (
                <img
                  key={i}
                  src={img || PH}
                  alt=""
                  onClick={() => setActiveImg(i)}
                  className={i === activeImg ? "on" : ""}
                />
              ))}
            </div>
          )}
        </div>

        <div className="sf-info">
          <div className="sf-cat">
            {p.category_name}
            {p.brand_name ? ` • ${p.brand_name}` : ""}
          </div>
          <h2>{p.name}</h2>
          <Stars rating={p.rating} reviews={p.review_count} />

          {p.short_description && (
            <p className="sf-short">{p.short_description}</p>
          )}

          {hasVariants && (
            <div className="sf-variants">
              <div className="sf-variants-label">Select option:</div>
              <div className="sf-variants-list">
                {variants.map((v, i) => {
                  const isActive = selectedVariantIdx === i;
                  const vOut = (v.stock ?? 0) <= 0;
                  return (
                    <button
                      key={i}
                      className={`sf-variant-btn ${isActive ? "on" : ""} ${vOut ? "disabled" : ""}`}
                      onClick={() => !vOut && setSelectedVariantIdx(i)}
                      disabled={vOut}
                    >
                      {v.name}
                      {vOut && <span className="sf-variant-oo">Sold out</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

            <div className="sf-price">
              <span className="sf-now">{inr(price)}</span>
              {hasDiscount && <span className="sf-was">{inr(variantBasePrice)}</span>}
              {off > 0 && <span className="sf-off">{off}% off</span>}
            </div>

          <div className={out ? "sf-stock low" : "sf-stock ok"} style={{ marginBottom: 12 }}>
            {out
              ? "Out of stock"
              : variantStock <= 5
                ? `Only ${variantStock} left in stock — order soon`
                : `${variantStock} available — ships from our warehouse to your location`}
            {hasVariants && activeVariant?.sku && (
              <span className="sf-variant-sku"> · SKU: {activeVariant.sku}</span>
            )}
          </div>

          {hasSpecs && (
            <div className="sf-specs">
              {Object.entries(p.attributes).map(([k, v]) => (
                <div className="sf-spec" key={k}>
                  <span>{k}</span>
                  <b>{String(v)}</b>
                </div>
              ))}
            </div>
          )}

          {!out && (
            <div className="sf-qty">
              <span>Qty</span>
              <div className="sf-stepper">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))}>
                  <FiMinus />
                </button>
                <b>{qty}</b>
                <button onClick={() => setQty((q) => Math.min(variantStock, q + 1))}>
                  <FiPlus />
                </button>
              </div>
            </div>
          )}

          <div className="sf-cta">
            <button className="sf-btn primary" disabled={out} onClick={handleAdd}>
              <FiShoppingCart /> Add to cart
            </button>
            <button className="sf-btn green" disabled={out} onClick={handleBuy}>
              Buy now
            </button>
          </div>

          <div className="sf-offers">
            <div><FiTruck /> Free delivery on this item</div>
            <div><FiShield /> Pay on delivery or via sandbox card</div>
          </div>

          {p.description && (
            <div className="sf-desc">
              <h3>Product description</h3>
              <p>{p.description}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CartView({ lines, onBack, onUpdate, onRemove, onCheckout, onShop, total, count }) {
  return (
    <div className="sf-cart">
      <div className="sf-page-title">
        <button className="sf-link" onClick={onBack}>
          <FiChevronLeft /> Continue shopping
        </button>
        <h2>Your cart {count > 0 && <span>({count})</span>}</h2>
      </div>

      {lines.length === 0 ? (
        <div className="sf-empty">
          <FiShoppingCart size={34} />
          <p>Your cart is empty.</p>
          <button className="sf-btn primary" onClick={onShop}>
            Start shopping
          </button>
        </div>
      ) : (
        <div className="sf-cart-cols">
          <div className="sf-lines">
            {lines.map((l) => {
              const useDisc =
                (l.discount_price ?? l.discountPrice) != null && Number((l.discount_price ?? l.discountPrice)) > 0;
              const price = useDisc ? Number((l.discount_price ?? l.discountPrice)) : Number(l.price);
              const img = l.images && l.images[0] ? l.images[0] : PH;
              const variantLabel = l._variant != null ? asText(l._variant) : null;
              const variantSku = asText(l._variantSku) || asText(l.sku) || null;
              return (
                <div className="sf-line" key={l.uuid}>
                  <img src={img} alt={l.name} />
                  <div className="sf-line-mid">
                    <div className="sf-line-name">
                      {l.name}
                      {variantLabel && (
                        <span className="sf-line-variant">{variantLabel}</span>
                      )}
                    </div>
                    <div className="muted">{inr(price)} each{variantSku ? ` · SKU: ${variantSku}` : ""}</div>
                    <div className="sf-stepper small">
                      <button onClick={() => onUpdate(l.uuid, l.quantity - 1)}>
                        <FiMinus />
                      </button>
                      <b>{l.quantity}</b>
                      <button onClick={() => onUpdate(l.uuid, l.quantity + 1)}>
                        <FiPlus />
                      </button>
                    </div>
                  </div>
                  <div className="sf-line-right">
                    <div className="sf-line-total">{inr(price * l.quantity)}</div>
                    <button className="sf-icon-btn" onClick={() => onRemove(l.uuid)} title="Remove">
                      <FiTrash2 />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="sf-totals">
            <h3>Order summary</h3>
            <div className="sf-totals-row">
              <span>Items ({count})</span>
              <span>{inr(total)}</span>
            </div>
            <div className="sf-totals-row">
              <span>Delivery</span>
              <span className="ok-text">Free</span>
            </div>
            <div className="sf-totals-row grand">
              <span>Total</span>
              <span>{inr(total)}</span>
            </div>
            <button className="sf-btn green checkout" onClick={onCheckout}>
              Proceed to checkout →
            </button>
            <p className="muted small">
              COD or sandbox card · prices verified server-side at checkout.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckoutForm({ lines, subtotal, selectedBranch, onDone, onBack }) {
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({
    customerName: "",
    customerEmail: "",
    customerMobile: "",
    paymentMethod: "cod",
    pincode: "",
    address: "",
    city: "",
    state: "",
  });
  const METHODS = [
    { id: "cod", icon: FiCreditCard, label: "Cash on Delivery", hint: "Pay when your order arrives" },
    { id: "stripe_sandbox", icon: FiCreditCard, label: "Card (sandbox)", hint: "Demo card — no real charge" },
    { id: "paypal_sandbox", icon: FiCreditCard, label: "PayPal (sandbox)", hint: "Demo checkout — no real charge" },
  ];

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function placeOrder(e) {
    e.preventDefault();
    setSending(true);
    setErr("");
    if (lines.length === 0) {
      setErr("Your cart is empty.");
      setSending(false);
      return;
    }
    const shipping = {
      pincode: form.pincode.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
    };
    const { ok, data } = await api("/orders/store", {
      method: "POST",
      body: JSON.stringify({
        customerName: form.customerName.trim(),
        customerEmail: form.customerEmail.trim().toLowerCase(),
        customerMobile: form.customerMobile.trim(),
        shippingAddress: shipping,
        paymentMethod: form.paymentMethod,
        ...(selectedBranch ? { branchId: selectedBranch.uuid } : {}),
        items: lines.map((l) => ({
          product_uuid: l.uuid,
          quantity: l.quantity,
          ...(l._variant ? { variant: l._variant } : {}),
          ...(l._variantSku ? { sku: l._variantSku } : {}),
        })),
      }),
    });
    setSending(false);
    if (!ok) {
      setErr(data.message || "Checkout failed. Try again.");
      return;
    }
    onDone(data.order);
  }

  return (
    <div>
      <div className="sf-page-title">
        <button className="sf-link" onClick={onBack}>
          <FiChevronLeft /> Back to cart
        </button>
        <h2>Checkout</h2>
      </div>

      <div className="sf-checkout-cols">
        <form className="sf-checkout-form" onSubmit={placeOrder}>
          <section className="sf-section">
            <h3><FiUser /> Contact details</h3>
            <div className="sf-field">
              <label>Full name *</label>
              <input className="sf-input" required value={form.customerName} onChange={set("customerName")} placeholder="Your name" />
            </div>
            <div className="sf-row-2">
              <div className="sf-field">
                <label>Email *</label>
                <input className="sf-input" type="email" required value={form.customerEmail} onChange={set("customerEmail")} placeholder="you@email.com" />
              </div>
              <div className="sf-field">
                <label>Mobile *</label>
                <input className="sf-input" required value={form.customerMobile} onChange={set("customerMobile")} placeholder="10-digit mobile" />
              </div>
            </div>
          </section>

          <section className="sf-section">
            <h3><FiMapPin /> Delivery address</h3>
            <div className="sf-field">
              <label>Address *</label>
              <textarea className="sf-input" required value={form.address} onChange={set("address")} placeholder="House / street / landmark" rows={2} />
            </div>
            <div className="sf-row-3">
              <div className="sf-field">
                <label>Pincode *</label>
                <input className="sf-input" required value={form.pincode} onChange={set("pincode")} placeholder="Pincode" />
              </div>
              <div className="sf-field">
                <label>City *</label>
                <input className="sf-input" required value={form.city} onChange={set("city")} />
              </div>
              <div className="sf-field">
                <label>State *</label>
                <input className="sf-input" required value={form.state} onChange={set("state")} />
              </div>
            </div>
          </section>

          <section className="sf-section">
            <h3><FiCreditCard /> Payment method</h3>
            {METHODS.map((m) => {
              const Icon = m.icon;
              return (
                <label
                  key={m.id}
                  className={`sf-radio ${form.paymentMethod === m.id ? "on" : ""}`}
                >
                  <input
                    type="radio"
                    name="pm"
                    checked={form.paymentMethod === m.id}
                    onChange={() => setForm((f) => ({ ...f, paymentMethod: m.id }))}
                  />
                  <Icon />
                  <span>
                    <b>{m.label}</b>
                    <small>{m.hint}</small>
                  </span>
                </label>
              );
            })}
          </section>

          {err && <div className="sf-err">{err}</div>}
          <button className="sf-btn green place" disabled={sending}>
            {sending ? "Placing order…" : `Place order — ${inr(subtotal)}`}
          </button>
        </form>

        <div className="sf-totals sticky">
          <h3>Order summary</h3>
          {lines.map((l) => {
            const price =
              (l.discount_price ?? l.discountPrice) != null && Number((l.discount_price ?? l.discountPrice)) > 0
                ? Number((l.discount_price ?? l.discountPrice))
                : Number(l.price);
            return (                <div className="sf-totals-row" key={l.uuid}>
                  <span>{asText(l.name) || "Product"} × {l.quantity}</span>
                  <span>{inr(price * l.quantity)}</span>
                </div>
            );
          })}
          <div className="sf-totals-row">
            <span>Subtotal</span>
            <span>{inr(subtotal)}</span>
          </div>
          <div className="sf-totals-row">
            <span>Delivery</span>
            <span className="ok-text">Free</span>
          </div>
          <div className="sf-totals-row grand">
            <span>Total</span>
            <span>{inr(subtotal)}</span>
          </div>
          {selectedBranch && (
            <div className="sf-checkout-store">
              <FiShoppingBag /> Fulfilled by <b>{selectedBranch.name}</b>
            </div>
          )}
          <p className="muted small">
            Stripe/PayPal run in sandbox — no real charges. Prices are verified
            server-side at checkout.
          </p>
        </div>
      </div>
    </div>
  );
}

function OrderTrack({ prefilledOrder, onBack }) {
  const [form, setForm] = useState({ order_number: "", email: "" });
  const [result, setResult] = useState(prefilledOrder || null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const STEPS = ["PLACED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"];
  const LABELS = {
    PLACED: "Placed",
    PACKED: "Packed",
    SHIPPED: "Shipped",
    OUT_FOR_DELIVERY: "Out for delivery",
    DELIVERED: "Delivered",
  };

  async function track(e) {
    if (e) e.preventDefault();
    setBusy(true);
    setErr("");
    const { ok, data } = await api(
      `/orders/track?order_number=${encodeURIComponent(form.order_number.trim())}&email=${encodeURIComponent(form.email.trim().toLowerCase())}`
    );
    setBusy(false);
    if (!ok) {
      setErr(data.message || "Order not found. Check your order number and email.");
      setResult(null);
      return;
    }
    // API returns { order, statusHistory, ... } — keep both for the UI.
    setResult({ ...data.order, statusHistory: data.statusHistory || [] });
  }

  // Customer bill download (guarded by order number + email).
  async function downloadBill() {
    try {
      const res = await fetch(
        `${BACKEND_BASE}/orders/track/invoice?order_number=${encodeURIComponent(form.order_number.trim() || result.order_number)}&email=${encodeURIComponent(form.email.trim().toLowerCase() || result.customer_email)}`
      );
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${result.order_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErr("Could not download the bill. Please try again.");
    }
  }

  const fmtTime = (v) =>
    v
      ? new Date(v).toLocaleString("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "";

  if (result && result.uuid && result.status) {
    const details = result;
    const stepIdx = STEPS.indexOf(details.status);
    return (
      <div>
        <div className="sf-page-title">
          <button
            className="sf-link"
            onClick={() => {
              setResult(null);
              setForm({ order_number: "", email: "" });
              onBack();
            }}
          >
            <FiChevronLeft /> Back
          </button>
          <h2>Order {details.order_number}</h2>
        </div>

        <div className="sf-track-card">
          <div className="sf-track-meta">
            <div><span>Status</span><b>{LABELS[details.status] || details.status.replace(/_/g, " ")}</b></div>
            <div><span>Total</span><b>{inr(details.total)}</b></div>
            <div>
              <span>Payment</span>
              <b>{(details.payment_method || "").replace(/_/g, " ").toUpperCase()} · {details.payment_status}</b>
            </div>
            {details.storeName && (
              <div><span>Store</span><b>{details.storeName}</b></div>
            )}
            {details.estimatedDeliveryAt && !"DELIVERED,CANCELLED".includes(details.status) && (
              <div>
                <span>Estimated delivery</span>
                <b>By {fmtTime(details.estimatedDeliveryAt)}</b>
              </div>
            )}
            <div>
              <span></span>
              <button className="sf-link" onClick={downloadBill}>⬇ Download Bill (PDF)</button>
            </div>
          </div>

          <div className="sf-timeline">
            {STEPS.map((s) => {
              const stIdx = STEPS.indexOf(s);
              const done = stepIdx >= 0 && stIdx <= stepIdx;
              const current = s === details.status;
              return (
                <div key={s} className={`sf-step ${done ? "done" : ""} ${current ? "current" : ""}`}>
                  <div className="sf-dot">{done && <span>{current ? "●" : "✓"}</span>}</div>
                  <span>{LABELS[s]}</span>
                </div>
              );
            })}
          </div>

          {/* WHEN each step happened — from the order status audit trail */}
          {details.statusHistory && details.statusHistory.length > 0 && (
            <div className="sf-history">
              <h4>Status updates</h4>
              {details.statusHistory.map((h, i) => (
                <div className="sf-history-row" key={i}>
                  <b>{LABELS[h.status] || h.status.replace(/_/g, " ")}</b>
                  <span className="sf-h-time">{fmtTime(h.createdAt)}</span>
                </div>
              ))}
            </div>
          )}

              {details.items && details.items.length > 0 && (
            <div className="sf-lines">
              {details.items.map((it, i) => (
                <div className="sf-line" key={i}>
                  <div className="sf-line-mid">
                    <div className="sf-line-name">
                      {it.product_name}
                      {it.variant && (
                        <span className="sf-line-variant">{it.variant}</span>
                      )}
                    </div>
                    <div className="muted">
                      {it.quantity} × {inr(it.price)}
                      {it.sku ? ` · SKU: ${it.sku}` : ""}
                    </div>
                  </div>
                  <div className="sf-line-total">{inr(it.subtotal)}</div>
                </div>
              ))}
            </div>
          )}

          {details.shipping_address && (
            <div className="sf-addr">
              <FiMapPin /> {details.shipping_address.address}, {details.shipping_address.city},{" "}
              {details.shipping_address.state} — {details.shipping_address.pincode}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="sf-track-form-wrap">
      <div className="sf-page-title">
        <button className="sf-link" onClick={onBack}>
          <FiChevronLeft /> Back to shop
        </button>
        <h2>Track your order</h2>
      </div>
      <form className="sf-track-form" onSubmit={track}>
        <div className="sf-field">
          <label>Order number</label>
          <input
            className="sf-input"
            required
            value={form.order_number}
            onChange={(e) => setForm((f) => ({ ...f, order_number: e.target.value }))}
            placeholder="ORD-0000001"
          />
        </div>
        <div className="sf-field">
          <label>Email used at checkout</label>
          <input
            className="sf-input"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="you@email.com"
          />
        </div>
        {err && <div className="sf-err">{err}</div>}
        <button className="sf-btn primary" disabled={busy} style={{ width: "100%", justifyContent: "center", padding: 13 }}>
          {busy ? "Checking…" : <><FiTruck /> Track order</>}
        </button>
      </form>
    </div>
  );
}

function AccountPanel({ onBack }) {
  const [mode, setMode] = useState("login");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setOk("");
    const body = { email: form.email.trim().toLowerCase(), password: form.password };
    if (mode === "register") body.name = form.name.trim();
    const res = await fetch(
      mode === "login" ? "/api/auth/login" : "/api/auth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!data.success) {
      setErr(data.message || "Something went wrong");
      return;
    }
    if (mode === "login") {
      setOk(`Logged in as ${data.user?.email || form.email}`);
      try {
        localStorage.setItem("sf_token", data.token);
      } catch {}
    } else {
      setOk("Registered! Check your email to verify, then log in.");
    }
  }

  return (
    <div className="sf-auth-wrap">
      <div className="sf-page-title">
        <button className="sf-link" onClick={onBack}>
          <FiChevronLeft /> Back to shop
        </button>
        <h2>My account</h2>
      </div>
      <div className="sf-auth">
        <div className="sf-auth-tabs">
          <button className={mode === "login" ? "on" : ""} onClick={() => { setMode("login"); setErr(""); setOk(""); }}>
            Login
          </button>
          <button className={mode === "register" ? "on" : ""} onClick={() => { setMode("register"); setErr(""); setOk(""); }}>
            Create account
          </button>
        </div>
        <form onSubmit={submit}>
          {mode === "register" && (
            <div className="sf-field">
              <label>Name</label>
              <input className="sf-input" required value={form.name} onChange={set("name")} />
            </div>
          )}
          <div className="sf-field">
            <label>Email</label>
            <input className="sf-input" type="email" required value={form.email} onChange={set("email")} />
          </div>
          <div className="sf-field">
            <label>Password</label>
            <input className="sf-input" type="password" required minLength={6} value={form.password} onChange={set("password")} />
          </div>
          {err && <div className="sf-err">{err}</div>}
          {ok && <div className="sf-stock ok" style={{ margin: "8px 0" }}>{ok}</div>}
          <button className="sf-btn green" style={{ width: "100%", justifyContent: "center", padding: 13 }}>
            {mode === "login" ? "Login" : "Register"}
          </button>
        </form>
      </div>
    </div>
  );
}

const CSS = `
.sf-root {
  --sf-bg:#f6f7f9; --sf-card:#fff; --sf-ink:#111827; --sf-mut:#6b7280;
  --sf-ac:#16a34a; --sf-ac-dark:#15803d; --sf-red:#dc2626; --sf-amber:#f59e0b;
  font-family: system-ui, "Segoe UI", Roboto, sans-serif;
  background:var(--sf-bg); color:var(--sf-ink); min-height:100vh;
  display:flex; flex-direction:column;
}
.sf-root * { box-sizing:border-box; }
.muted{color:var(--sf-mut)} .small{font-size:12px} .ok-text{color:var(--sf-ac);font-weight:600}

/* Announcement bar */
.sf-announce{background:var(--sf-ink);color:#fff;text-align:center;font-size:12.5px;padding:7px 14px;letter-spacing:.2px}

/* Header */
.sf-top{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.95);backdrop-filter:blur(8px);border-bottom:1px solid #e5e7eb}
.sf-top-in{max-width:1140px;margin:0 auto;display:flex;align-items:center;gap:18px;padding:12px 20px}
.sf-brand{display:flex;align-items:center;gap:9px;background:none;border:0;cursor:pointer;font-size:19px;font-weight:800;color:var(--sf-ink)}
.sf-logo{width:34px;height:34px;border-radius:10px;background:var(--sf-ac);color:#fff;display:flex;align-items:center;justify-content:center}
.sf-brand em{font-style:normal;color:var(--sf-ac)}
.sf-nav{display:flex;gap:4px;margin-left:8px}
.sf-nav button{display:flex;align-items:center;gap:6px;background:none;border:0;cursor:pointer;font-size:14px;color:var(--sf-mut);padding:8px 12px;border-radius:9px}
.sf-nav button:hover{background:#eff6f0;color:var(--sf-ink)}
.sf-nav button.on{background:var(--sf-ac);color:#fff}
.sf-spacer{flex:1}
.sf-cart-btn{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:9px 14px;cursor:pointer;font-size:14px;font-weight:600;position:relative}
.sf-cart-btn:hover{border-color:var(--sf-ac);background:#f0fdf4}
.sf-cart-btn b{position:absolute;top:-7px;right:-7px;background:var(--sf-red);color:#fff;border-radius:50%;min-width:19px;height:19px;font-size:11px;display:flex;align-items:center;justify-content:center;padding:0 4px;border:2px solid #fff}
.sf-branch-btn{display:flex;align-items:center;gap:6px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:9px 14px;cursor:pointer;font-size:13px;font-weight:600;color:var(--sf-ink);position:relative;z-index:10}
.sf-branch-btn:hover{border-color:var(--sf-ac);background:#f0fdf4}
.sf-branch-dropdown{position:absolute;top:calc(100% + 6px);right:0;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.12);min-width:240px;z-index:50;overflow:hidden}
.sf-branch-option{display:block;width:100%;text-align:left;background:none;border:0;padding:10px 16px;cursor:pointer;font-size:13px;border-bottom:1px solid #f3f4f6}
.sf-branch-option:last-child{border-bottom:0}
.sf-branch-option:hover{background:#f0fdf4}
.sf-branch-option.on{background:#f0fdf4;color:var(--sf-ac);font-weight:700}
.sf-branch-option strong{display:block;font-size:14px;color:var(--sf-ink)}
.sf-branch-option span{display:block;font-size:11.5px;color:var(--sf-mut)}
.sf-branch-option.on strong{color:var(--sf-ac)}
.sf-branch-option.on span{color:var(--sf-ac)}

/* Body / footer */
.sf-body{flex:1;max-width:1140px;margin:0 auto;padding:24px 20px 60px;width:100%}
.sf-footer{margin-top:30px;background:var(--sf-ink);color:#d1d5db;display:grid;grid-template-columns:2fr 1fr 1fr;gap:30px;padding:40px 20px}
.sf-footer > div{max-width:1140px;margin:0 auto;width:100%}
.sf-footer-b{border-top:1px solid rgba(255,255,255,.1);padding-top:20px;margin-top:30px;max-width:1140px;margin-left:auto;margin-right:auto}
.sf-footer b{display:block;color:#fff;margin-bottom:10px}
.sf-footer-brand{font-size:18px;color:var(--sf-ac)}
.sf-footer-brand em{font-style:normal;color:#fff}
.sf-footer p{font-size:13px;line-height:1.6;max-width:320px}
.sf-footer button,.sf-footer span{display:block;background:none;border:0;color:#d1d5db;font-size:13px;padding:3px 0;cursor:pointer;text-align:left}
.sf-footer button:hover{color:#fff}

/* Trust strip */
.sf-trust{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}
.sf-trust span{display:flex;align-items:center;gap:6px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:8px 13px;font-size:12.5px;font-weight:600;color:var(--sf-mut)}
.sf-trust svg{color:var(--sf-ac)}

/* Banner */
.sf-banner{position:relative;border-radius:16px;overflow:hidden;margin-bottom:22px;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.08)}
.sf-banner img{width:100%;height:280px;object-fit:cover;display:block;background:#eef2f7}
.sf-banner-veil{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.45),transparent 60%)}
.sf-banner-text{position:absolute;left:26px;top:50%;transform:translateY(-50%);color:#fff;max-width:420px}
.sf-banner-text h2{font-size:26px;margin:0 0 6px;text-shadow:0 2px 6px rgba(0,0,0,.4)}
.sf-banner-text p{margin:0;font-size:14px;opacity:.95}
.sf-banner-cta{display:inline-block;margin-top:14px;background:var(--sf-ac);padding:9px 16px;border-radius:9px;font-weight:700;font-size:13px}
.sf-banner-expiry{display:inline-flex;align-items:center;gap:6px;margin-top:12px;padding:8px 12px;border-radius:8px;background:#0f172a;color:#fecaca;font-weight:600;font-size:11.5px;font-style:normal}
.sf-banner-expiry::before{content:"";width:7px;height:7px;border-radius:50%;background:#f87171;animation:sf-pulse 1.2s infinite}
@keyframes sf-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.85)}}
.sf-banner-dots{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);display:flex;gap:7px}
.sf-banner-dots span{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.6);cursor:pointer}
.sf-banner-dots span.on{background:#fff;width:22px;border-radius:4px}

/* Category chips */
.sf-cats{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.sf-cats button{background:#fff;border:1px solid #e5e7eb;border-radius:20px;padding:7px 15px;font-size:13px;cursor:pointer;font-weight:600;color:var(--sf-mut)}
.sf-cats button:hover{border-color:var(--sf-ac);color:var(--sf-ac)}
.sf-cats button.on{background:var(--sf-ac);border-color:var(--sf-ac);color:#fff}

/* Toolbar / search */
.sf-toolbar{display:flex;gap:10px;margin-bottom:20px}
.sf-search{flex:1;display:flex;align-items:center;gap:9px;background:#fff;border:1px solid #e5e7eb;border-radius:11px;padding:0 14px;max-width:460px}
.sf-search svg{color:var(--sf-mut)}
.sf-search input{border:0;outline:0;flex:1;padding:12px 0;font-size:14px;background:transparent;color:var(--sf-ink)}
.sf-search input:focus+.sf-search{outline:none}

/* Buttons */
.sf-btn{border:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px;font-size:14px;font-weight:600;padding:10px 16px;border-radius:10px;color:var(--sf-ink);background:#f3f4f6}
.sf-btn:hover{filter:brightness(.97)}
.sf-btn.primary{background:var(--sf-ac);color:#fff}
.sf-btn.primary:hover{background:var(--sf-ac-dark)}
.sf-btn.green{background:var(--sf-ac);color:#fff}
.sf-btn.green:hover{background:var(--sf-ac-dark)}
.sf-btn.ghost{background:#fff;border:1px solid #e5e7eb}
.sf-btn:disabled{opacity:.45;cursor:not-allowed}

/* Inputs */
.sf-input{border:1px solid #d1d5db;border-radius:10px;padding:10px 12px;font-size:14px;background:#fff;color:var(--sf-ink);width:100%}
.sf-input:focus{outline:2px solid var(--sf-ac);outline-offset:1px;border-color:transparent}
.sf-field label{display:block;font-size:13px;font-weight:600;margin-bottom:5px}

/* Product grid / cards */
.sf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}
.sf-card{background:var(--sf-card);border-radius:14px;border:1px solid #e5e7eb;overflow:hidden;display:flex;flex-direction:column;cursor:pointer;transition:transform .15s,box-shadow .15s}
.sf-card:hover{transform:translateY(-3px);box-shadow:0 10px 24px rgba(0,0,0,.10)}
.sf-card-img{position:relative;overflow:hidden;background:#fff}
.sf-card-img img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;transition:transform .3s}
.sf-card:hover .sf-card-img img{transform:scale(1.05)}
.sf-badge-off{position:absolute;top:10px;left:10px;background:var(--sf-red);color:#fff;font-size:12px;font-weight:700;padding:3px 9px;border-radius:8px}
.sf-badge-feat{position:absolute;top:10px;right:10px;background:var(--sf-amber);color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:8px}
.sf-cover{position:absolute;inset:0;background:rgba(255,255,255,.75);display:flex;align-items:center;justify-content:center;color:var(--sf-red);font-weight:700;font-size:15px}
.sf-card-body{padding:13px;display:flex;flex-direction:column;gap:6px;flex:1}
.sf-cat{font-size:11.5px;color:var(--sf-mut);text-transform:uppercase;letter-spacing:.4px}
.sf-name{font-weight:600;font-size:14px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:38px}
.sf-stars{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--sf-innk)}
.sf-stars-row{display:inline-flex;color:var(--sf-amber)}
.sf-stars svg.off{color:#d1d5db}
.sf-price{display:flex;align-items:baseline;gap:8px}
.sf-now{font-weight:800;font-size:16px}
.sf-was{font-size:12px;color:var(--sf-mut);text-decoration:line-through}
.sf-off{font-size:12px;color:var(--sf-ac);font-weight:700}
.sf-stock{font-size:12px}
.sf-stock.low{color:var(--sf-red);font-weight:600}
.sf-stock.ok{color:var(--sf-ac)}
.sf-card-actions{margin-top:auto;display:flex;gap:8px;padding-top:6px}
.sf-card-actions .sf-btn{flex:1;font-size:13px;padding:9px 6px}
.sf-card-actions .add{background:var(--sf-ac);color:#fff}

/* Skeleton */
.sf-skeleton{pointer-events:none}
.sk-img{aspect-ratio:1/1;background:linear-gradient(100deg,#eef2f7 40%,#f8fafc 50%,#eef2f7 60%)}
.sf-skeleton .sk{display:block;border-radius:6px;background:linear-gradient(100deg,#eef2f7 40%,#f8fafc 50%,#eef2f7 60%)}
.sk-l{height:14px;width:70%}.sk-m{height:12px;width:90%}.sk-s{height:11px;width:45%}

/* Pagination */
.sf-pager{display:flex;justify-content:center;align-items:center;gap:6px;margin-top:26px}
.sf-pager .sf-btn{border:1px solid #e5e7eb;background:#fff;min-width:36px;height:36px}
.sf-page{min-width:36px;height:36px;border-radius:9px;border:1px solid #e5e7eb;background:#fff;cursor:pointer;font-weight:600}
.sf-page.active{background:var(--sf-ac);color:#fff;border-color:var(--sf-ac)}
.sf-pager-pos{display:flex;gap:6px;align-items:center}
.sf-ellipsis{color:var(--sf-mut);padding:0 2px}

/* Toast / errors / empty */
.sf-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--sf-ink);color:#fff;padding:11px 18px;border-radius:11px;font-size:14px;z-index:100;box-shadow:0 8px 24px rgba(0,0,0,.25);animation:sfPop .2s ease}
@keyframes sfPop{from{opacity:0;transform:translateX(-50%) translateY(8px)}}
.sf-err{background:#fef2f2;color:var(--sf-red);border:1px solid #fecaca;padding:11px 14px;border-radius:10px;font-size:14px;margin-bottom:14px}
.sf-empty{text-align:center;color:var(--sf-mut);padding:60px 16px}
.sf-empty svg{margin:0 auto 12px;color:var(--sf-mut)}
.sf-empty p{margin:0 0 16px;font-size:15px}
.sf-empty{margin:0}
.sf-empty .sf-btn{display:inline-flex;margin:0 auto}

/* Breadcrumb */
.sf-breadcrumb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--sf-mut);margin-bottom:16px;flex-wrap:wrap}
.sf-breadcrumb button{background:none;border:0;cursor:pointer;color:var(--sf-ac);font-weight:600;font-size:13px;padding:0}
.sf-breadcrumb b{color:var(--sf-ink)}

/* Detail */
.sf-detail{display:grid;grid-template-columns:1fr 1fr;gap:32px;background:var(--sf-card);border:1px solid #e5e7eb;border-radius:16px;padding:24px}
.sf-gallery img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:12px;background:#f1f5f9}
.sf-thumbs{display:flex;gap:9px;margin-top:10px}
.sf-thumbs img{width:60px;height:60px;object-fit:cover;border-radius:9px;cursor:pointer;border:2px solid transparent}
.sf-thumbs img.on{border-color:var(--sf-ac)}
.sf-info h2{margin:2px 0 8px;font-size:22px}
.sf-short{color:var(--sf-mut);font-size:14px;margin:4px 0 12px;line-height:1.5}
.sf-specs{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#e5e7eb;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin:16px 0;font-size:13px}
.sf-spec{background:#fff;padding:9px 12px;display:flex;justify-content:space-between;gap:10px}
.sf-spec span{color:var(--sf-mut)}
.sf-qty{display:flex;align-items:center;gap:14px;margin:18px 0}
.sf-qty > span{font-weight:600;font-size:14px}
.sf-stepper{display:flex;align-items:center;gap:2px;border:1px solid #d1d5db;border-radius:10px;overflow:hidden;background:#fff}
.sf-stepper button{width:36px;height:38px;border:0;background:#f9fafb;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--sf-ink)}
.sf-stepper button:hover{background:#eef2f7}
.sf-stepper b{min-width:36px;text-align:center;font-size:15px}
.sf-stepper.small button{width:30px;height:30px}
.sf-stepper.small b{min-width:30px;font-size:14px}
.sf-cta{display:flex;gap:10px}
.sf-cta .sf-btn{flex:1;padding:13px;font-size:15px}
.sf-offers{display:grid;gap:8px;margin-top:16px;padding-top:16px;border-top:1px dashed #e5e7eb}
.sf-offers div{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--sf-mut)}
.sf-offers svg{color:var(--sf-ac)}
.sf-desc{margin-top:22px}
.sf-desc h3{font-size:15px;margin:0 0 6px}
.sf-desc p{font-size:14px;color:var(--sf-mut);white-space:pre-line;line-height:1.6}

/* Page title */
.sf-page-title{margin-bottom:18px}
.sf-page-title h2{margin:6px 0 0;font-size:22px}
.sf-link{display:inline-flex;align-items:center;gap:4px;background:none;border:0;cursor:pointer;color:var(--sf-ac);font-weight:600;font-size:14px;padding:0}

/* Cart */
.sf-cart-cols{display:grid;grid-template-columns:1fr 340px;gap:20px;align-items:start}
.sf-lines{display:grid;gap:10px}
.sf-line{display:flex;gap:14px;align-items:center;background:var(--sf-card);border:1px solid #e5e7eb;border-radius:12px;padding:12px}
.sf-line img{width:70px;height:70px;object-fit:cover;border-radius:9px;background:#f1f5f9}
.sf-line-mid{flex:1}
.sf-line-name{font-weight:600;font-size:14px}
.sf-line-right{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.sf-line-total{font-weight:700;font-size:15px}
.sf-icon-btn{background:none;border:0;cursor:pointer;color:var(--sf-mut);padding:6px}
.sf-icon-btn:hover{color:var(--sf-red)}
.sf-totals{background:var(--sf-card);border:1px solid #e5e7eb;border-radius:14px;padding:18px}
.sf-totals h3{margin:0 0 12px;font-size:16px}
.sf-totals-row{display:flex;justify-content:space-between;padding:7px 0;font-size:13.5px;gap:10px}
.sf-totals-row.grand{font-weight:800;font-size:16px;border-top:1px solid #e5e7eb;margin-top:6px;padding-top:12px}
.sf-totals .checkout{width:100%;margin-top:14px;padding:13px}
.sf-totals .small{padding-top:10px;color:var(--sf-mut)}
.sf-totals.sticky{position:sticky;top:84px}
.sf-totals .sf-totals-row span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis}

/* Checkout */
.sf-checkout-cols{display:grid;grid-template-columns:1fr 340px;gap:20px;align-items:start}
.sf-checkout-form{display:grid;gap:16px}
.sf-section{background:var(--sf-card);border:1px solid #e5e7eb;border-radius:14px;padding:18px}
.sf-section h3{display:flex;align-items:center;gap:8px;margin:0 0 14px;font-size:15px}
.sf-section h3 svg{color:var(--sf-ac)}
.sf-row-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.sf-row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.sf-radio{display:flex;align-items:center;gap:11px;border:1px solid #d1d5db;border-radius:11px;padding:13px;cursor:pointer;margin-bottom:9px;background:#fff}
.sf-radio svg{color:var(--sf-mut)}
.sf-radio.on{border-color:var(--sf-ac);background:#f0fdf4}
.sf-radio.on svg{color:var(--sf-ac)}
.sf-radio input{accent-color:var(--sf-ac)}
.sf-radio span{display:flex;flex-direction:column;gap:2px}
.sf-radio small{color:var(--sf-mut)}
.sf-btn.place{width:100%;padding:14px;font-size:15px}

/* Track */
.sf-track-card{background:var(--sf-card);border:1px solid #e5e7eb;border-radius:16px;padding:22px}
.sf-track-meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:6px}
.sf-track-meta > div{background:#f9fafb;border:1px solid #e5e7eb;border-radius:11px;padding:12px 14px;display:flex;flex-direction:column;gap:3px}
.sf-track-meta span{font-size:12px;color:var(--sf-mut)}
.sf-track-meta b{font-size:14px}
.sf-timeline{display:flex;justify-content:space-between;margin:26px 0;position:relative}
.sf-timeline:before{content:"";position:absolute;top:12px;left:8%;right:8%;height:3px;border-radius:3px;background:#e5e7eb}
.sf-step{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:7px;width:20%;font-size:11.5px;color:var(--sf-mut);text-align:center}
.sf-dot{width:25px;height:25px;border-radius:50%;background:#fff;border:2.5px solid #e5e7eb;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;transition:all .2s}
.sf-step.done .sf-dot{border-color:var(--sf-ac);background:var(--sf-ac)}
.sf-step.done{color:var(--sf-ink);font-weight:600}
.sf-step.current .sf-dot{border-color:var(--sf-ac);background:#fff;color:var(--sf-ac);box-shadow:0 0 0 4px rgba(22,163,74,.15)}
.sf-step.current .sf-dot span{color:var(--sf-ac);font-size:9px}
.sf-history{margin:18px 0 4px;padding:14px 16px;background:#f8faf7;border:1px solid #e3ece5;border-radius:12px}
.sf-history h4{margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--sf-mut)}
.sf-history-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:13px;border-bottom:1px dashed #dfe8e1}
.sf-history-row:last-child{border-bottom:0}
.sf-history-row b{font-weight:600;color:var(--sf-ink)}
.sf-history-row .sf-h-time{color:var(--sf-mut);font-size:12.5px}
.sf-checkout-store{display:flex;align-items:center;gap:8px;margin-top:12px;padding:11px 13px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;font-size:13px;color:var(--sf-ac-dark)}
.sf-checkout-store b{font-weight:700}
.sf-checkout-store svg{flex-shrink:0}
.sf-addr{display:flex;align-items:flex-start;gap:8px;margin-top:16px;padding:13px;background:#f9fafb;border-radius:10px;font-size:13.5px;color:var(--sf-mut)}
.sf-addr svg{color:var(--sf-ac);flex-shrink:0;margin-top:2px}
.sf-track-form-wrap,.sf-auth-wrap{max-width:520px}
.sf-track-form{background:var(--sf-card);border:1px solid #e5e7eb;border-radius:14px;padding:20px;display:grid;gap:4px}

/* Auth */
.sf-auth{background:var(--sf-card);border:1px solid #e5e7eb;border-radius:16px;padding:22px}
.sf-auth-tabs{display:flex;gap:8px;margin-bottom:18px;background:#f3f4f6;border-radius:11px;padding:5px}
.sf-auth-tabs button{flex:1;border:0;background:none;cursor:pointer;padding:9px;border-radius:8px;font-weight:600;font-size:14px;color:var(--sf-mut)}
.sf-auth-tabs button.on{background:#fff;color:var(--sf-ac);box-shadow:0 1px 4px rgba(0,0,0,.08)}

@media (max-width:820px){
  .sf-detail{grid-template-columns:1fr}
  .sf-cart-cols,.sf-checkout-cols{grid-template-columns:1fr}
  .sf-totals.sticky{position:static}
  .sf-track-meta{grid-template-columns:1fr}
  .sf-footer{grid-template-columns:1fr}
  .sf-banner-text h2{font-size:20px}
}
@media (max-width:520px){
  .sf-top-in{flex-wrap:wrap;gap:8px}
  .sf-nav{margin-left:0;order:3}
  .sf-toolbar{flex-direction:column}
  .sf-search{max-width:none}
  .sf-row-2,.sf-row-3{grid-template-columns:1fr}
  .sf-banner img{height:200px}
}

/* Variant selector */
.sf-variants{margin:10px 0}
.sf-variants-label{font-size:13px;font-weight:600;margin-bottom:6px;color:var(--sf-ink)}
.sf-variants-list{display:flex;flex-wrap:wrap;gap:8px}
.sf-variant-btn{background:#fff;border:1.5px solid #d1d5db;border-radius:9px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;color:var(--sf-mut);transition:border-color .15s,background .15s}
.sf-variant-btn:hover{border-color:var(--sf-ac);color:var(--sf-ac)}
.sf-variant-btn.on{background:var(--sf-ac);border-color:var(--sf-ac);color:#fff}
.sf-variant-btn.disabled{opacity:.4;cursor:not-allowed;text-decoration:line-through}
.sf-variant-btn.disabled:hover{border-color:#d1d5db;color:var(--sf-mut)}
.sf-variant-oo{display:block;font-size:10px;font-weight:400;color:var(--sf-red);text-align:center;margin-top:2px}
.sf-variants-preview{display:flex;flex-wrap:wrap;gap:5px;margin:4px 0 6px}
.sf-variant-chip{background:#f0fdf4;border:1px solid #bbf7d0;color:var(--sf-ac-dark);font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px}
.sf-variant-chip.more{background:#f3f4f6;border-color:#d1d5db;color:var(--sf-mut)}
.sf-line-variant{display:inline-block;background:#f0fdf4;color:var(--sf-ac-dark);font-size:11px;font-weight:600;padding:1px 6px;border-radius:8px;margin-left:6px;vertical-align:middle}
.sf-variant-sku{font-size:12px;color:var(--sf-mut)}

/* ============================================================
   V2 DESIGN SYSTEM — refresh layer (overrides above)
   ============================================================ */
.sf-root{
  --sf-bg:#f4f6f3; --sf-card:#fff; --sf-ink:#101b10; --sf-mut:#68766b;
  --sf-ac:#1f9d55; --sf-ac-dark:#157347; --sf-ac-soft:#eaf7ef;
  --sf-red:#dc2626; --sf-amber:#f59e0b;
  --sf-line:#e5e9e4; --sf-line-soft:#eef1ec;
  --sf-r-lg:18px; --sf-r-md:13px; --sf-r-sm:10px;
  --sf-sh-sm:0 1px 2px rgba(16,27,16,.05),0 2px 8px rgba(16,27,16,.04);
  --sf-sh-md:0 6px 20px rgba(16,27,16,.08);
  --sf-sh-lg:0 18px 50px rgba(16,27,16,.16);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  -webkit-font-smoothing:antialiased;
  background:var(--sf-bg); color:var(--sf-ink); min-height:100vh;
  display:flex; flex-direction:column;
}

/* Announcement */
.sf-announce{background:#0d1f12;color:#cfe8d6;text-align:center;font-size:12.5px;padding:8px 14px;letter-spacing:.2px}
.sf-announce-in{display:inline-flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:center}
.sf-announce-item{display:inline-flex;align-items:center;gap:6px}
.sf-announce-item svg{color:#4ade80}
.sf-announce-dot{width:4px;height:4px;border-radius:50%;background:#3a5c44;display:inline-block}

/* Header */
.sf-top{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.88);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--sf-line)}
.sf-top-in{max-width:1180px;margin:0 auto;display:flex;align-items:center;gap:16px;padding:10px 20px}
.sf-brand{display:flex;align-items:center;gap:9px;background:none;border:0;cursor:pointer;font-size:19px;font-weight:800;color:var(--sf-ink);letter-spacing:-.2px}
.sf-logo{width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,var(--sf-ac),var(--sf-ac-dark));color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:var(--sf-sh-sm)}
.sf-brand em{font-style:normal;color:var(--sf-ac)}
.sf-nav{display:flex;gap:4px;margin-left:6px}
.sf-nav button{display:flex;align-items:center;gap:6px;background:none;border:0;cursor:pointer;font-size:13.5px;font-weight:600;color:var(--sf-mut);padding:8px 13px;border-radius:var(--sf-r-sm);transition:background .15s,color .15s}
.sf-nav button:hover{background:var(--sf-ac-soft);color:var(--sf-ac-dark)}
.sf-nav button.on{background:var(--sf-ac-soft);color:var(--sf-ac-dark)}
.sf-spacer{flex:1}
.sf-cart-btn{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--sf-line);border-radius:var(--sf-r-sm);padding:8px 14px;cursor:pointer;font-size:13.5px;font-weight:600;position:relative;transition:border-color .15s,background .15s}
.sf-cart-btn:hover{border-color:var(--sf-ac);background:var(--sf-ac-soft)}
.sf-cart-btn b{position:absolute;top:-7px;right:-7px;background:var(--sf-red);color:#fff;border-radius:50%;min-width:19px;height:19px;font-size:11px;display:flex;align-items:center;justify-content:center;padding:0 4px;border:2px solid #fff}

/* Store selector */
.sf-branch-wrap{position:relative}
.sf-branch-btn{display:flex;align-items:center;gap:9px;background:#fff;border:1px solid var(--sf-line);border-radius:var(--sf-r-sm);padding:6px 12px;cursor:pointer;color:var(--sf-ink);transition:border-color .15s,background .15s}
.sf-branch-btn:hover{border-color:var(--sf-ac);background:var(--sf-ac-soft)}
.sf-branch-btn > svg:last-child{color:var(--sf-mut)}
.sf-branch-btn > svg:first-child{color:var(--sf-ac)}
.sf-branch-txt{display:flex;flex-direction:column;align-items:flex-start;line-height:1.15}
.sf-branch-txt small{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--sf-mut);font-weight:600}
.sf-branch-txt strong{font-size:13px;font-weight:700;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-branch-dropdown{position:absolute;top:calc(100% + 8px);right:0;background:#fff;border:1px solid var(--sf-line);border-radius:var(--sf-r-md);box-shadow:var(--sf-sh-lg);min-width:260px;z-index:60;overflow:hidden;animation:sfDrop .16s ease}
@keyframes sfDrop{from{opacity:0;transform:translateY(-5px)}}
.sf-branch-head{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--sf-mut);padding:11px 16px 7px}
.sf-branch-option{display:block;width:100%;text-align:left;background:none;border:0;padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--sf-line-soft)}
.sf-branch-option:last-of-type{border-bottom:0}
.sf-branch-option:hover{background:var(--sf-ac-soft)}
.sf-branch-option.on{background:var(--sf-ac-soft)}
.sf-branch-option strong{display:flex;align-items:center;gap:7px;font-size:13.5px;color:var(--sf-ink)}
.sf-branch-option span{display:block;font-size:11.5px;color:var(--sf-mut);margin-top:1px}
.sf-branch-option.on strong{color:var(--sf-ac-dark)}
.sf-branch-code{font-style:normal;font-size:10px;font-weight:700;background:var(--sf-ac-soft);color:var(--sf-ac-dark);padding:1px 6px;border-radius:6px;letter-spacing:.4px}
.sf-branch-none{padding:16px;text-align:center;font-size:12.5px;color:var(--sf-mut)}

/* Hero */
.sf-hero{position:relative;border-radius:22px;overflow:hidden;margin-bottom:22px;isolation:isolate}
.sf-hero-bg{position:absolute;inset:0;z-index:-1;background:linear-gradient(115deg,#0d3b1e 0%,#14532d 45%,#1f7a3f 100%)}
.sf-hero-bg::before{content:"";position:absolute;inset:0;background:radial-gradient(720px 340px at 88% 8%,rgba(74,222,128,.28),transparent 60%),radial-gradient(520px 300px at 8% 100%,rgba(255,255,255,.10),transparent 55%)}
.sf-hero-in{padding:52px 48px 48px;color:#fff}
.sf-hero-kicker{display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.13);border:1px solid rgba(255,255,255,.22);padding:6px 13px;border-radius:99px;font-size:12.5px;font-weight:600;color:#d8f5e0}
.sf-hero-in h1{font-size:36px;line-height:1.16;letter-spacing:-.6px;margin:16px 0 8px;font-weight:800}
.sf-hero-in > p{font-size:15px;color:#c8e6d1;max-width:540px;margin:0 0 24px;line-height:1.55}
.sf-hero-search{display:flex;align-items:center;gap:10px;background:#fff;border-radius:14px;padding:6px 6px 6px 16px;max-width:560px;box-shadow:var(--sf-sh-lg)}
.sf-hero-search > svg{color:var(--sf-mut);flex-shrink:0}
.sf-hero-search input{border:0;outline:0;flex:1;min-width:0;padding:11px 0;font-size:14.5px;background:transparent;color:var(--sf-ink)}
.sf-hero-go{border-radius:10px;padding:11px 22px}
.sf-hero-tags{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
.sf-hero-tags button{background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.22);color:#e4f6ea;border-radius:99px;padding:6px 14px;font-size:12.5px;font-weight:600;cursor:pointer;transition:background .15s}
.sf-hero-tags button:hover{background:rgba(255,255,255,.22)}

/* Trust strip */
.sf-trust{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:22px}
.sf-trust span{display:flex;align-items:center;gap:9px;background:#fff;border:1px solid var(--sf-line);border-radius:var(--sf-r-md);padding:12px 14px;font-size:13px;font-weight:600;color:var(--sf-ink);box-shadow:var(--sf-sh-sm)}
.sf-trust svg{color:var(--sf-ac);flex-shrink:0}

/* Category chips */
.sf-cats{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
.sf-cats button{background:#fff;border:1px solid var(--sf-line);border-radius:99px;padding:7px 16px;font-size:13px;cursor:pointer;font-weight:600;color:var(--sf-mut);transition:all .15s}
.sf-cats button:hover{border-color:var(--sf-ac);color:var(--sf-ac-dark);background:var(--sf-ac-soft)}
.sf-cats button.on{background:var(--sf-ink);border-color:var(--sf-ink);color:#fff}

/* Section head */
.sf-section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin:6px 0 14px}
.sf-section-head h2{margin:0;font-size:20px;font-weight:800;letter-spacing:-.3px}
.sf-section-head p{margin:3px 0 0;font-size:12.5px;color:var(--sf-mut)}
.sf-section-page{font-size:12px;color:var(--sf-mut);background:#fff;border:1px solid var(--sf-line);padding:5px 12px;border-radius:99px;white-space:nowrap}

/* Buttons / inputs */
.sf-btn{border:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px;font-size:14px;font-weight:600;padding:10px 16px;border-radius:var(--sf-r-sm);color:var(--sf-ink);background:#eef1ec;transition:filter .15s,background .15s}
.sf-btn:hover{filter:brightness(.97)}
.sf-btn.primary,.sf-btn.green{background:var(--sf-ac);color:#fff}
.sf-btn.primary:hover,.sf-btn.green:hover{background:var(--sf-ac-dark);filter:none}
.sf-btn.ghost{background:#fff;border:1px solid var(--sf-line)}
.sf-btn:disabled{opacity:.45;cursor:not-allowed}
.sf-input{border:1px solid var(--sf-line);border-radius:var(--sf-r-sm);padding:10px 12px;font-size:14px;background:#fff;color:var(--sf-ink);width:100%;transition:border-color .15s,box-shadow .15s}
.sf-input:focus{outline:none;border-color:var(--sf-ac);box-shadow:0 0 0 3px rgba(31,157,85,.14)}
.sf-field label{display:block;font-size:12.5px;font-weight:700;margin-bottom:5px}

/* Cards */
.sf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(236px,1fr));gap:16px}
.sf-card{background:var(--sf-card);border-radius:var(--sf-r-lg);border:1px solid var(--sf-line-soft);overflow:hidden;display:flex;flex-direction:column;cursor:pointer;transition:transform .18s,box-shadow .18s,border-color .18s;box-shadow:var(--sf-sh-sm)}
.sf-card:hover{transform:translateY(-3px);box-shadow:var(--sf-sh-md);border-color:var(--sf-line)}
.sf-card-img{position:relative;overflow:hidden;background:#f4f6f3}
.sf-card-img img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;transition:transform .35s}
.sf-card:hover .sf-card-img img{transform:scale(1.05)}
.sf-badge-off{position:absolute;top:10px;left:10px;background:var(--sf-red);color:#fff;font-size:11px;font-weight:800;padding:4px 9px;border-radius:8px;letter-spacing:.3px}
.sf-badge-feat{position:absolute;top:10px;right:10px;background:var(--sf-amber);color:#fff;font-size:11px;font-weight:700;padding:4px 9px;border-radius:8px}
.sf-cover{position:absolute;inset:0;background:rgba(255,255,255,.78);backdrop-filter:blur(1px);display:flex;align-items:center;justify-content:center;color:var(--sf-red);font-weight:800;font-size:14px}
.sf-card-body{padding:13px 14px 14px;display:flex;flex-direction:column;gap:5px;flex:1}
.sf-cat{font-size:10.5px;color:var(--sf-mut);text-transform:uppercase;letter-spacing:.6px;font-weight:700}
.sf-name{font-weight:700;font-size:14px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:38px}
.sf-card-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:4px}
.sf-add-btn{width:34px;height:34px;border-radius:10px;border:0;background:var(--sf-ac);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:background .15s,transform .12s}
.sf-add-btn:hover{background:var(--sf-ac-dark);transform:scale(1.06)}
.sf-add-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}

/* Skeleton / pager / toast / empty */
.sf-skeleton{pointer-events:none}
.sk-img{aspect-ratio:1/1;background:linear-gradient(100deg,#eef2f0 40%,#f7faf8 50%,#eef2f0 60%)}
.sf-skeleton .sk{display:block;border-radius:6px;background:linear-gradient(100deg,#eef2f0 40%,#f7faf8 50%,#eef2f0 60%)}
.sf-page{min-width:36px;height:36px;border-radius:var(--sf-r-sm);border:1px solid var(--sf-line);background:#fff;cursor:pointer;font-weight:600}
.sf-page.active{background:var(--sf-ac);color:#fff;border-color:var(--sf-ac)}
.sf-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#132a18;color:#fff;padding:12px 18px;border-radius:12px;font-size:14px;z-index:100;box-shadow:var(--sf-sh-lg);animation:sfPop .2s ease;display:flex;align-items:center;gap:9px}
.sf-toast::before{content:"";width:8px;height:8px;border-radius:50%;background:#4ade80}

/* Sections */
.sf-section{background:var(--sf-card);border:1px solid var(--sf-line);border-radius:var(--sf-r-lg);padding:20px;box-shadow:var(--sf-sh-sm)}
.sf-line,.sf-totals,.sf-track-card,.sf-auth,.sf-track-form{border-radius:var(--sf-r-lg);box-shadow:var(--sf-sh-sm)}
.sf-section h3 svg,.sf-radio.on,.sf-offers svg{color:var(--sf-ac)}

/* Footer */
.sf-footer{margin-top:34px;background:#0d1f12;color:#b9cdbf;padding:0 20px}
.sf-footer-grid{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:2fr 1fr 1fr;gap:34px;padding:42px 0 30px}
.sf-footer b{display:block;color:#fff;margin-bottom:10px}
.sf-footer-brand{font-size:19px;color:#4ade80}
.sf-footer-brand em{font-style:normal;color:#fff}
.sf-footer p{font-size:13px;line-height:1.6;max-width:330px;margin:0 0 12px}
.sf-footer-usp{display:grid;gap:5px}
.sf-footer-usp span{display:flex;align-items:center;gap:7px;font-size:12.5px;color:#9fb8a7}
.sf-footer-usp svg{color:#4ade80}
.sf-footer-col button,.sf-footer-col span{display:flex;align-items:center;gap:8px;background:none;border:0;color:#b9cdbf;font-size:13px;padding:4px 0;cursor:pointer;text-align:left}
.sf-footer-col button:hover{color:#fff}
.sf-footer-col svg{color:#3f5c48}
.sf-footer-b{max-width:1180px;margin:0 auto;border-top:1px solid rgba(255,255,255,.08);padding:16px 0 20px;font-size:12.5px;color:#7d9585}

/* Responsive */
@media (max-width:960px){
  .sf-hero-in{padding:38px 30px 36px}
  .sf-hero-in h1{font-size:28px}
  .sf-trust{grid-template-columns:repeat(2,1fr)}
}
@media (max-width:820px){
  .sf-detail{grid-template-columns:1fr}
  .sf-cart-cols,.sf-checkout-cols{grid-template-columns:1fr}
  .sf-totals.sticky{position:static}
  .sf-track-meta{grid-template-columns:1fr}
  .sf-footer-grid{grid-template-columns:1fr;gap:24px;padding:34px 0 22px}
}
@media (max-width:560px){
  .sf-top-in{flex-wrap:wrap;gap:8px;padding:10px 14px}
  .sf-nav{margin-left:0;order:3}
  .sf-branch-txt small{display:none}
  .sf-branch-txt strong{max-width:100px}
  .sf-hero-in{padding:30px 20px 28px}
  .sf-hero-in h1{font-size:23px}
  .sf-hero-search{flex-wrap:nowrap}
  .sf-hero-go{padding:10px 14px}
  .sf-trust{grid-template-columns:1fr 1fr}
  .sf-section-head{flex-direction:column;align-items:flex-start;gap:6px}
  .sf-grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
  .sf-announce-dot{display:none}
}
`;