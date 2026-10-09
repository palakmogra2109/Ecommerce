import { useCallback, useEffect, useRef, useState } from "react";
import {
  FiHome, FiShoppingCart, FiTruck, FiUser, FiSearch,
  FiChevronLeft, FiChevronRight, FiPlus, FiMinus, FiTrash2,
  FiShield, FiCreditCard, FiRefreshCw, FiStar, FiMapPin, FiShoppingBag,
  FiChevronDown, FiClock, FiPhoneCall, FiMail, FiCheckCircle,
  FiLogIn, FiLogOut, FiPackage, FiGift, FiEdit2, FiAlertTriangle, FiTag,
  FiCalendar, FiSend,
} from "react-icons/fi";

import { giftCardImage, scopeSummary } from "../lib/giftCardArt";
import "../styles/Storefront.css";
// The account panel reuses the shared auth field styling; Auth.css is pulled
// in here because this page does not render AuthCard (which would import it).
import "../styles/Auth.css";

import AuthField from "../components/auth/AuthField";
import PhoneInput from "../components/PhoneInput";
import LocationChip from "../components/storefront/LocationChip";
import AddressBookModal from "../components/storefront/AddressBookModal";
import AddressForm from "../components/storefront/AddressForm";
import useAddressBook from "../hooks/useAddressBook";
import { validateEmail, validatePassword, validateMobile } from "../utils/validation";

import {
  getStoreProducts, getStoreProduct, getStoreBanners, getStoreBranches,
  placeStoreOrder, trackStoreOrder, downloadOrderInvoice,
  storeLogin, setStoreToken, requestOtp, verifyOtp, updateStoreProfile, getMyOrders,
  quoteCheckout, getWallet, previewGiftCardCode, claimGiftCardCode, purchaseGiftCard, getDenominations,
  inr, asText, cartLineId, sanitizeCartLine,
  resolveDisplayPrice, linePrice, discountOf, isDiscounted, discountPercent,
  PLACEHOLDER_IMAGE, ORDER_STEPS, STEP_LABELS, PAYMENT_METHODS,
  bannerIsLive, bannerTimeLeft,
} from "../services/storefront";

const VIEWS = {
  CATALOG: 1,
  DETAIL: 2,
  CART: 3,
  CHECKOUT: 4,
  TRACK: 5,
  ACCOUNT: 6,
  PROFILE: 7,
  ADDRESSES: 8,
  GIFTCARDS: 9,
  BUYGC: 10,
  ECARDS: 11,
};

// --------------------------------------------------------- gift card redeem box
//
// normalizeCode from backend/lib/giftCardCodeGen.js, repeated rather than
// imported: that module is server-side (it pulls in node:crypto for the hashing
// and is reached through the backend's own resolver), and this is a separate
// app surface with its own bundle. The rule is one line, it is stable, and a
// disagreement would be cosmetic — the server normalises again on arrival, so
// this only saves the shopper from typing a code in the wrong case.
//
// Kept here rather than in the panel so there is one definition if a second
// panel ever grows a code box.
const normalizeRedeemCode = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .toUpperCase();

// Below this a lookup is a guess, not a lookup: the server's throttle counts a
// miss against a budget, and nobody finishes typing a code in three characters.
const PREVIEW_MIN_CHARS = 3;
const PREVIEW_DEBOUNCE_MS = 400;
// The shape a code is printed in: GIFT- then two groups of four. Once the field
// matches it the shopper has stopped typing, so there is nothing left to debounce.
const CODE_SHAPE = /^GIFT-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

// The shopper's view survives reloads via localStorage: plain views store
// the id, product detail stores { view, productUuid } and refetches on mount.
function readSavedView() {
  try {
    const saved = JSON.parse(localStorage.getItem("sf_view"));
    const view = typeof saved === "number" ? saved : saved?.view;
    if (!Object.values(VIEWS).includes(view)) return {};
    if (view === VIEWS.DETAIL) {
      const productUuid = typeof saved === "object" ? asText(saved.productUuid) : "";
      return productUuid ? { view, productUuid } : {};
    }
    return { view };
  } catch {
    return {};
  }
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
  const [view, setView] = useState(() => readSavedView().view || VIEWS.CATALOG);
  // A denomination chosen on the E-Cards shelf, handed to the buy page.
  const [selectedDenom, setSelectedDenom] = useState(null);
  const [products, setProducts] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });
  const [locationFallback, setLocationFallback] = useState(false);
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
    try { return JSON.parse(localStorage.getItem("sf_branch")) || null; } catch { return null; }
  });
  const [branchList, setBranchList] = useState([]);
  const [showBranchSelector, setShowBranchSelector] = useState(false);
  const [toast, setToast] = useState(null);
  const [placedOrder, setPlacedOrder] = useState(null);

  // ---- Logged-in user + account dropdown ----
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("sf_user")) || null; } catch { return null; }
  });
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);
  const branchMenuRef = useRef(null);
  // Where to send the user after they log in (e.g. back to the product page)
  const [postLoginView, setPostLoginView] = useState(null);

  // Server-backed address book (selection only is mirrored to localStorage).
  const addressBook = useAddressBook({ user, notify });
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [storeCount, setStoreCount] = useState(null);

  const needsRealEmail = (u) => (u?.email || "").toLowerCase().endsWith("@mobile.local");

  // Safety nets: checkout is never reachable while logged out, and never
  // on a placeholder OTP email — registration is only complete with a real
  // address, since orders and the address book key off it.
  useEffect(() => {
    if (view === VIEWS.CHECKOUT && !user) {
      setPostLoginView(VIEWS.CHECKOUT);
      setView(VIEWS.ACCOUNT);
      notify("Please log in to checkout");
      return;
    }
    if (view === VIEWS.CHECKOUT && needsRealEmail(user)) {
      setPostLoginView(VIEWS.CHECKOUT);
      setView(VIEWS.PROFILE);
      notify("Add your real email to complete registration");
    }
  }, [view, user]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function onDoc(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
      if (branchMenuRef.current && !branchMenuRef.current.contains(e.target)) {
        setShowBranchSelector(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    localStorage.setItem("sf_cart", JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    try {
      if (view === VIEWS.DETAIL && current?.uuid) {
        localStorage.setItem("sf_view", JSON.stringify({ view, productUuid: current.uuid }));
      } else if (view !== VIEWS.DETAIL) {
        localStorage.setItem("sf_view", JSON.stringify({ view }));
      }
    } catch {}
  }, [view, current?.uuid]);

  // A reloaded product page refetches its product, then steps back in.
  useEffect(() => {
    const saved = readSavedView();
    if (saved.view !== VIEWS.DETAIL || !saved.productUuid) return;
    let live = true;
    getStoreProduct(saved.productUuid).then(({ ok, data }) => {
      if (!live) return;
      if (ok && data.product) {
        setCurrent(data.product);
        setView(VIEWS.DETAIL);
      }
    });
    return () => { live = false; };
    // Mount-only: afterwards the persist effect above owns sf_view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Checkout with an empty cart (e.g. restored after the cart was cleared)
  // drops back to the cart instead of stranding on an empty form.
  useEffect(() => {
    if (view === VIEWS.CHECKOUT && cart.length === 0) setView(VIEWS.CART);
  }, [view, cart.length]);

  // A persisted store id can go stale (store deleted, renamed, or saved from
  // another database). A stale id scopes the catalog to zero rows, so the
  // grid renders "No products found" with no way out. Validate it once on
  // mount against the public store list and drop it when the server no
  // longer knows it. A failed fetch keeps the selection: offline is not
  // proof the store is gone.
  useEffect(() => {
    let live = true;
    if (!selectedBranch?.uuid) return;
    getStoreBranches({ limit: 100 }).then(({ ok, data }) => {
      if (!live || !ok || !data.success) return;
      const stillThere = (data.branches || []).some((b) => b.uuid === selectedBranch.uuid);
      if (!stillThere) {
        clearBranch();
        notify("Your saved store is no longer available — showing all stores.");
      }
    });
    return () => { live = false; };
    // Mount-only: re-validating on every branch change would fight the selector.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function notify(msg) {
    setToast(msg);
    clearTimeout(notify._t);
    notify._t = setTimeout(() => setToast(null), 2600);
  }

  function handleLogin(u) {
    setUser(u);
    try { localStorage.setItem("sf_user", JSON.stringify(u)); } catch {}
    addressBook.claimLegacyAddresses(u);
    if (needsRealEmail(u)) {
      // postLoginView is left intact: after the email is saved the shopper
      // can continue wherever they were headed.
      setView(VIEWS.PROFILE);
      notify("Welcome! Add your real email to complete registration.");
      return;
    }
    setView(postLoginView || VIEWS.CATALOG);
    setPostLoginView(null);
    notify(`Welcome, ${u?.name || u?.email || "back"}!`);
  }

  // Returns true if logged in; otherwise sends the user to the login page.
  function requireLogin(nextView, msg) {
    if (user) return true;
    setPostLoginView(nextView || VIEWS.CATALOG);
    setShowUserMenu(false);
    setView(VIEWS.ACCOUNT);
    notify(msg || "Please log in to continue");
    return false;
  }

  function handleLogout() {
    setUser(null);
    setShowUserMenu(false);
    setStoreToken(null);
    try { localStorage.removeItem("sf_user"); } catch {}
    setView(VIEWS.CATALOG);
    notify("Logged out");
  }

  function openAddressBook() {
    if (!requireLogin(VIEWS.ADDRESSES, "Please log in to manage saved addresses.")) return;
    setAddressModalOpen(true);
  }

  function goTo(v) {
    if (v === VIEWS.ADDRESSES && !user) {
      setShowUserMenu(false);
      requireLogin(VIEWS.ADDRESSES, "Please log in to manage saved addresses.");
      return;
    }
    setShowUserMenu(false);
    setView(v);
  }

  function locationParamsFor(address) {
    const latitude = Number(address?.latitude);
    const longitude = Number(address?.longitude);
    return {
      pincode: address?.postalCode || "",
      lat: Number.isFinite(latitude) ? latitude : null,
      lng: Number.isFinite(longitude) ? longitude : null,
    };
  }

  const selectedAddress = addressBook.selectedAddress;
  const locationParams = locationParamsFor(selectedAddress);

  // One fetch, one effect. Previously two effects both called loadProducts
  // (so every mount and every branch change fired the request twice), and the
  // branch handlers called it a third time alongside the setter. `search` is a
  // dependency here so the hero tag chips and the empty-state reset actually
  // search for the value they just set instead of the previous one.
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");

    getStoreProducts({
      page,
      limit: 12,
      search,
      category,
      branchId: selectedBranch?.uuid || null,
      pincode: locationParams.pincode,
      lat: locationParams.lat,
      lng: locationParams.lng,
    }).then(({ ok, data }) => {
      if (!live) return;
      if (!ok) {
        setError(data.message || "Could not load products");
        setLocationFallback(false);
      } else {
        setProducts(data.products || []);
        setPagination(data.pagination || { total: 0, pages: 1 });
        setLocationFallback(data.locationFallback === true);
      }
      setLoading(false);
    });

    return () => { live = false; };
  }, [page, category, search, selectedBranch?.uuid, selectedAddress?.id, selectedAddress?.postalCode, selectedAddress?.latitude, selectedAddress?.longitude]);

  async function loadBranchesFor(address) {
    const location = locationParamsFor(address);
    let response;
    try {
      response = await getStoreBranches({
        limit: 100,
        pincode: location.pincode,
        lat: location.lat,
        lng: location.lng,
      });
    } catch {
      response = { ok: false, data: { message: "Could not load stores." } };
    }
    if (!response.ok || !response.data.success) {
      notify(response.data.message || "Could not load stores.");
      return null;
    }
    const branches = Array.isArray(response.data.branches) ? response.data.branches : [];
    setBranchList(branches);
    setStoreCount(branches.length);
    return branches;
  }

  async function loadBranches() {
    return loadBranchesFor(selectedAddress);
  }

  async function handleAddressSelect(entry) {
    addressBook.selectAddress(entry.id);
    setAddressModalOpen(false);
    setPage(1);
    const branches = await loadBranchesFor(entry);
    if (!branches) {
      notify(`Delivering to ${entry.label || "saved address"} · ${entry.city || ""}`);
      return;
    }
    if (selectedBranch && !branches.some((branch) => branch.uuid === selectedBranch.uuid)) {
      setSelectedBranch(null);
      try {
        localStorage.removeItem("sf_branch");
      } catch {}
    }
    notify(`Delivering to ${entry.label || "saved address"} · ${entry.city || ""} — ${branches.length} store${branches.length === 1 ? "" : "s"}`);
  }

  function clearBranch() {
    setSelectedBranch(null);
    try { localStorage.removeItem("sf_branch"); } catch {}
  }

  function handleBranchSelect(branch) {
    setSelectedBranch(branch);
    if (branch) {
      localStorage.setItem("sf_branch", JSON.stringify(branch));
    } else {
      localStorage.removeItem("sf_branch");
    }
    setShowBranchSelector(false);
    setPage(1);
  }

  function goCatalog() {
    setView(VIEWS.CATALOG);
    setCurrent(null);
    setPage(1);
    setSearch("");
    setCategory("");
  }

  function addToCart(product, quantity = 1, variant = null) {
    if (!requireLogin(view, "Please log in to add items to your cart")) return;
    const q = Math.max(1, parseInt(quantity, 10) || 1);
    const variantName = variant?.name != null ? asText(variant.name) : null;
    const variantPrice = variant?.price != null ? Number(variant.price) : Number(product.price);
    const variantStock = variant?.stock ?? product.stock;
    const variantDiscount = discountOf(variant) ?? discountOf(product) ?? 0;
    const hasDiscount = isDiscounted(variantDiscount, variantPrice);
    const effectivePrice = hasDiscount ? variantDiscount : variantPrice;
    const lineId = cartLineId(product.uuid, variantName);

    setCart((prev) => {
      const existing = prev.find((i) => i.lineId === lineId);
      if (existing) {
        return prev.map((i) =>
          i.lineId === lineId
            ? { ...i, quantity: Math.min(i.quantity + q, variantStock || 99) }
            : i,
        );
      }
      return [
        ...prev,
        {
          ...product,
          lineId,
          quantity: Math.min(q, variantStock || 99),
          price: effectivePrice,
          // Kept so the cart can show the real saving. Lines saved before this
          // existed simply fall back to no strikethrough.
          _mrp: variantPrice,
          discount_price: hasDiscount ? variantDiscount : discountOf(product),
          _variant: variantName,
          _variantSku: variant?.sku || product.sku,
        },
      ];
    });

    notify(`"${product.name}${variantName ? ` (${variantName})` : ""}" added to cart`);
  }

  // Keyed on lineId, not uuid: the same product in two variants is two lines
  // and each needs its own stepper. Matching on uuid alone moved both at once
  // and removing one removed both.
  function updateQty(lineId, q) {
    setCart((prev) =>
      prev
        .map((i) => (i.lineId === lineId ? { ...i, quantity: Math.max(0, q) } : i))
        .filter((i) => i.quantity > 0),
    );
  }

  const cartCount = cart.reduce((s, i) => s + Number(i.quantity || 0), 0);
  const cartTotal = cart.reduce((s, i) => s + Number(i.quantity || 0) * linePrice(i), 0);

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
        onRemove={(lineId) => updateQty(lineId, 0)}
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
        user={user}
        addressBook={addressBook}
        notify={notify}
        onDone={(order) => {
          setPlacedOrder(order);
          setCart([]);
          setView(VIEWS.TRACK);
        }}
        onBack={() => setView(VIEWS.CART)}
      />
    ),
    [VIEWS.TRACK]: <OrderTrack prefilledOrder={placedOrder} user={user} onBack={goCatalog} onLogin={() => requireLogin(VIEWS.TRACK, "Please log in to see your orders")} />,
    [VIEWS.ACCOUNT]: <AccountPanel onBack={goCatalog} onLogin={handleLogin} />,
    [VIEWS.PROFILE]: <ProfilePanel user={user} onBack={goCatalog} onUpdate={(u) => { setUser(u); try { localStorage.setItem("sf_user", JSON.stringify(u)); } catch {} }} />,
    [VIEWS.ADDRESSES]: <AddressesPanel addressBook={addressBook} notify={notify} onBack={goCatalog} />,
    [VIEWS.GIFTCARDS]: <WalletPanel onBack={goCatalog} onShop={goCatalog} onBuyCards={() => goTo(VIEWS.ECARDS)} />,
    [VIEWS.BUYGC]: (
      <BuyGiftCard
        onBack={() => (selectedDenom ? goTo(VIEWS.ECARDS) : goTo(VIEWS.GIFTCARDS))}
        onDone={() => goTo(VIEWS.GIFTCARDS)}
        initialDenomination={selectedDenom}
        onConsumeDenomination={() => setSelectedDenom(null)}
      />
    ),
    [VIEWS.ECARDS]: (
      <ECardsShelf
        onBack={goCatalog}
        onViewWallet={() => goTo(VIEWS.GIFTCARDS)}
        onBuy={(d) => { setSelectedDenom(d); goTo(VIEWS.BUYGC); }}
      />
    ),
  };

  const showBanner = view === VIEWS.CATALOG;

  return (
    <div className="sf-root">
      <header className="sf-top">
        <div className="sf-top-in">
          <button className="sf-brand" onClick={goCatalog}>
            <span className="sf-logo"><FiHome /></span>
            <span>Earth<em>धान्य</em></span>
          </button>
          <LocationChip address={selectedAddress} loading={addressBook.loading} onOpen={openAddressBook} />
          <nav className="sf-nav">
            <button className={view === VIEWS.TRACK ? "on" : ""} onClick={() => setView(VIEWS.TRACK)}>
              <FiTruck /> Track
            </button>
          </nav>
          <div className="sf-spacer" />
          <button className="sf-cart-btn" onClick={() => setView(VIEWS.CART)}>
            <FiShoppingCart />
            <span>Cart</span>
            {cartCount > 0 && <b>{cartCount}</b>}
          </button>

          {/* Store selector */}
          {/* <div className="sf-branch-wrap" ref={branchMenuRef}>
            <button className="sf-branch-btn" onClick={() => { loadBranches(); setShowBranchSelector(!showBranchSelector); setShowUserMenu(false); }}>
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
                <button className="sf-branch-option" onClick={() => handleBranchSelect(null)}>
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
          </div> */}

          {/* Account: Login button when logged out, dropdown when logged in */}
          {user ? (
            <div className="sf-user-wrap" ref={userMenuRef}>
              <button
                className="sf-user-btn"
                onClick={() => { setShowUserMenu((s) => !s); setShowBranchSelector(false); }}
              >
                <span className="sf-avatar">
                  {(user.name || user.email || "U").trim().charAt(0).toUpperCase()}
                </span>
                <span className="sf-user-txt">
                  <small>Hello,</small>
                  <strong>{(user.name || user.email || "User").split(" ")[0]}</strong>
                </span>
                <FiChevronDown />
              </button>

              {showUserMenu && (
                <div className="sf-user-dropdown">
                  <div className="sf-user-head">
                    <b>{user.name || "My account"}</b>
                    <span>{user.email}</span>
                  </div>
                  <button onClick={() => goTo(VIEWS.TRACK)}><FiPackage /> Orders</button>
                  <button onClick={() => goTo(VIEWS.PROFILE)}><FiUser /> Account details</button>
                  <button onClick={() => goTo(VIEWS.ADDRESSES)}><FiMapPin /> Saved addresses</button>
                  <button onClick={() => goTo(VIEWS.GIFTCARDS)}><FiGift /> My cards &amp; balance</button>
                  <button onClick={() => goTo(VIEWS.ECARDS)}><FiSend /> Gift cards for sale</button>
                  <button className="danger" onClick={handleLogout}><FiLogOut /> Logout</button>
                </div>
              )}
            </div>
          ) : (
            <button className="sf-btn primary sf-login-btn" onClick={() => setView(VIEWS.ACCOUNT)}>
              <FiLogIn /> Login
            </button>
          )}
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
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setPage(1);
                    }}
                  />
                  <button className="sf-btn primary sf-hero-go" onClick={() => setPage(1)}>Search</button>
                </div>
                <div className="sf-hero-tags">
                  {["Rice", "Oil", "Wheat", "Spices"].map((tag) => (
                    <button key={tag} onClick={() => { setSearch(tag); setPage(1); }}>{tag}</button>
                  ))}
                </div>
              </div>
            </section>

            {showBanner && <BannerCarousel />}


            {!loading && products.length > 0 && (
              <div className="sf-cats">
                <button className={!category ? "on" : ""} onClick={() => { setCategory(""); setPage(1); }}>
                  All
                </button>
                {[
                  ...new Map(products.map((p) => [p.category_slug, p.category_name])),
                ].map(([slug, name]) => (
                  <button
                    key={slug || name}
                    className={category === slug ? "on" : ""}
                    onClick={() => { setCategory(slug || ""); setPage(1); }}
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
                <button className="sf-btn primary" onClick={() => { setSearch(""); setCategory(""); setPage(1); clearBranch(); }}>
                  View all products
                </button>
              </div>
            ) : (
              <>
                {locationFallback && selectedAddress && (
                  <div className="sf-notice">
                    No stores deliver to {selectedAddress.city || selectedAddress.postalCode || "your location"} yet — showing all products.
                  </div>
                )}
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
                      onOpen={() => { setCurrent(p); setView(VIEWS.DETAIL); }}
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
                          Math.abs(n - page) <= 2,
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

        <AddressBookModal
          open={addressModalOpen}
          addressBook={addressBook}
          user={user}
          notify={notify}
          onSelect={handleAddressSelect}
          onClose={() => setAddressModalOpen(false)}
        />
      </main>

      <footer className="sf-footer">
        <div className="sf-footer-glow" aria-hidden="true" />
        <div className="sf-footer-grid">
          <div className="sf-footer-col">
            <b className="sf-footer-brand">Earth<em>धान्य</em></b>
            <p>Farm-fresh essentials for every Indian kitchen. Honest prices, doorstep delivery.</p>
            <div className="sf-footer-usp">
              <span><FiCheckCircle /> 100% quality-checked</span>
              <span><FiCheckCircle /> Transparent pricing</span>
            </div>
            <div className="sf-footer-social">
              <button type="button" aria-label="Instagram" className="sf-social"><FiSend /></button>
              <button type="button" aria-label="Twitter" className="sf-social"><FiTag /></button>
              <button type="button" aria-label="Email" className="sf-social"><FiMail /></button>
            </div>
          </div>
          <div className="sf-footer-col">
            <b>Shop</b>
            <button onClick={goCatalog} className="sf-flink">All products</button>
            <button onClick={() => setView(VIEWS.TRACK)} className="sf-flink">Track order</button>
            <button onClick={() => setView(user ? VIEWS.PROFILE : VIEWS.ACCOUNT)} className="sf-flink">My account</button>
            <button onClick={() => setView(user ? VIEWS.EGIFT : VIEWS.EGIFT)} className="sf-flink">E-Gift Cards</button>
          </div>
          <div className="sf-footer-col">
            <b>Support</b>
            <span><FiMail /> orders@earthdhanya.in</span>
            <span><FiPhoneCall /> +91 98765 43210</span>
            <span><FiClock /> Mon–Sat, 9am–7pm</span>
          </div>
        </div>
        <div className="sf-footer-b">
          © {new Date().getFullYear()} Quick Kart · All rights reserved
        </div>
      </footer>
    </div>
  );
}

function ProductCard({ p, onOpen, onAdd }) {
  const variants = Array.isArray(p.variants) && p.variants.length > 0 ? p.variants : [];
  const { price, mrp } = resolveDisplayPrice(p);
  const useDisc = mrp > 0 && price < mrp;
  const off = useDisc ? discountPercent(price, mrp) : 0;
  const out = p.stock <= 0;
  const img = p.images && p.images[0] ? p.images[0] : PLACEHOLDER_IMAGE;
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
            onClick={(e) => { e.stopPropagation(); onAdd(p, 1, variants[0] || null); }}
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
    { endsAt: null, uuid: null },
  );

  useEffect(() => {
    if (!longer.endsAt) return;
    const inMs = Math.max(0, longer.endsAt - Date.now());
    const t = setTimeout(() => setNow(Date.now()), Math.min(inMs + 100, 0x7fffffff));
    return () => clearTimeout(t);
  }, [longer.endsAt, longer.uuid, now]);

  useEffect(() => {
    getStoreBanners("hero").then(({ ok, data }) => {
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
  const live = banners.filter((bn) => bannerIsLive(bn, now));

  useEffect(() => {
    if (idx >= live.length) setIdx(0);
  }, [live.length]);

  if (live.length === 0) return null;
  const b = live[idx % live.length];
  const expiry = b.ends_at ? bannerTimeLeft(b.ends_at) : null;

  return (
    <div
      className="sf-banner"
      onClick={() => b.link && window.open(b.link, "_blank")}
    >
      <img src={b.image || PLACEHOLDER_IMAGE} alt={b.title} />
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
              onClick={(e) => { e.stopPropagation(); setIdx(i); }}
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
  const variants = Array.isArray(p.variants) && p.variants.length > 0 ? p.variants : [];

  useEffect(() => {
    let live = true;
    getStoreProduct(initial.uuid).then(({ ok, data }) => {
      if (live && ok && data.product) setP({ ...initial, ...data.product });
    });
    return () => { live = false; };
  }, [initial.uuid]);

  // Reset variant selection when the shopper opens a different product.
  useEffect(() => {
    setSelectedVariantIdx(-1);
  }, [initial.uuid]);

  const hasVariants = variants.length > 0;
  const activeVariant = hasVariants ? variants[selectedVariantIdx] || variants[0] : null;
  const basePrice = activeVariant?.price != null ? Number(activeVariant.price) : Number(p.price);
  const discount = discountOf(activeVariant) ?? discountOf(p) ?? 0;
  const hasDiscount = isDiscounted(discount, basePrice);
  const price = hasDiscount ? discount : basePrice;
  const variantStock = activeVariant?.stock ?? Number(p.stock);
  const off = hasDiscount ? discountPercent(discount, basePrice) : 0;
  const out = variantStock <= 0;
  const images = p.images && p.images.length ? p.images : [null];
  const hasSpecs =
    p.attributes && typeof p.attributes === "object" && Object.keys(p.attributes).length > 0;

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
          <img src={images[activeImg] || PLACEHOLDER_IMAGE} alt={p.name} />
          {images.length > 1 && (
            <div className="sf-thumbs">
              {images.map((img, i) => (
                <img
                  key={i}
                  src={img || PLACEHOLDER_IMAGE}
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

          {p.short_description && <p className="sf-short">{p.short_description}</p>}

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
            {hasDiscount && <span className="sf-was">{inr(basePrice)}</span>}
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
                <button onClick={() => setQty((q) => Math.max(1, q - 1))}><FiMinus /></button>
                <b>{qty}</b>
                {/* Capped at the variant's own stock, and reset when the
                    shopper switches to a variant with less available. */}
                <button
                  onClick={() => setQty((q) => Math.max(1, Math.min(variantStock, q + 1)))}
                  disabled={qty >= variantStock}
                >
                  <FiPlus />
                </button>
              </div>
            </div>
          )}

          <div className="sf-cta">
            <button className="sf-btn primary" disabled={out} onClick={() => onAdd(p, qty, activeVariant)}>
              <FiShoppingCart /> Add to cart
            </button>
            <button className="sf-btn green" disabled={out} onClick={() => onBuy(p, qty, activeVariant)}>
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
  // What the cart would cost with no offers, so a saving is visible rather
  // than silently folded into the total.
  const listTotal = lines.reduce(
    (s, l) => s + Number(l.quantity || 0) * (Number(l._mrp ?? l.price) || 0),
    0
  );
  const saved = Math.max(0, listTotal - total);
  const savingsPct = listTotal > 0 ? Math.round((saved / listTotal) * 100) : 0;

  return (
    <div className="sf-cart">
      <div className="sf-page-title">
        <button className="sf-link" onClick={onBack}><FiChevronLeft /> Continue shopping</button>
        <h2>
          Your cart
          {count > 0 && <span className="sf-cart-count">{count}</span>}
        </h2>
      </div>

      {lines.length === 0 ? (
        <div className="sf-empty">
          <FiShoppingCart size={34} />
          <p>Your cart is empty.</p>
          <p className="muted small">Add something and it will show up here.</p>
          <button className="sf-btn primary" onClick={onShop}>Start shopping</button>
        </div>
      ) : (
        <div className="sf-cart-cols">
          <div className="sf-lines">
            {lines.map((l) => {
              const price = linePrice(l);
              const img = l.images && l.images[0] ? l.images[0] : PLACEHOLDER_IMAGE;
              const variantLabel = asText(l._variant) || null;
              const variantSku = asText(l._variantSku) || asText(l.sku) || null;
              // price is what is charged; _mrp is the pre-discount base, which
              // older saved lines do not have.
              const mrp = Number(l._mrp ?? l.price) || 0;
              const onSale = mrp > price;
              const off = onSale ? discountPercent(price, mrp) : 0;
              const stock = Number(l.stock ?? l.availableQuantity ?? NaN);
              const low = Number.isFinite(stock) && stock > 0 && stock <= 3;

              return (
                <div className="sf-line" key={l.lineId}>
                  <img src={img} alt={l.name} />
                  <div className="sf-line-mid">
                    <div className="sf-line-name">
                      {l.name}
                      {variantLabel && <span className="sf-line-variant">{variantLabel}</span>}
                    </div>

                    <div className="sf-line-price">
                      {onSale ? (
                        <>
                          <b>{inr(price)}</b>
                          <s>{inr(mrp)}</s>
                          <span className="sf-line-off">{off}% off</span>
                        </>
                      ) : (
                        <b>{inr(price)}</b>
                      )}
                      <span className="muted">each</span>
                      {variantSku && <span className="sf-variant-sku">SKU: {variantSku}</span>}
                    </div>

                    <div className="sf-line-actions">
                      <div className="sf-stepper small">
                        <button
                          type="button"
                          onClick={() => onUpdate(l.lineId, l.quantity - 1)}
                          aria-label={`Reduce ${l.name}`}
                        >
                          <FiMinus />
                        </button>
                        <b>{l.quantity}</b>
                        <button
                          type="button"
                          onClick={() => onUpdate(l.lineId, l.quantity + 1)}
                          disabled={Number.isFinite(stock) && l.quantity >= stock}
                          aria-label={`Add one more ${l.name}`}
                        >
                          <FiPlus />
                        </button>
                      </div>
                      {low && (
                        <span className="sf-line-stock">
                          Only {stock} left
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="sf-line-right">
                    <div className="sf-line-total">{inr(price * l.quantity)}</div>
                    {onSale && (
                      <div className="sf-line-was">{inr(mrp * l.quantity)}</div>
                    )}
                    <button
                      type="button"
                      className="sf-icon-btn"
                      onClick={() => onRemove(l.lineId)}
                      title={`Remove ${l.name}`}
                      aria-label={`Remove ${l.name}`}
                    >
                      <FiTrash2 />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* sticky already existed in the stylesheet but was never applied, so
              the summary scrolled away with the items. */}
          <div className="sf-totals sticky">
            <h3>Order summary</h3>
            <div className="sf-totals-row">
              <span>Items ({count})</span>
              <span>{inr(listTotal)}</span>
            </div>
            {saved > 0 && (
              <div className="sf-totals-row sf-totals-save">
                <span>Discount</span>
                <span>−{inr(saved)}</span>
              </div>
            )}
            <div className="sf-totals-row">
              <span>Delivery</span>
              <span className="ok-text">Free</span>
            </div>
            <div className="sf-totals-row grand">
              <span>Total</span>
              <span>{inr(total)}</span>
            </div>
            {saved > 0 && (
              <p className="sf-totals-save-note">You save {inr(saved)} ({savingsPct}%)</p>
            )}
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

function CheckoutForm({ lines, subtotal, selectedBranch, user, addressBook, notify, onDone, onBack }) {
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [giftCardCode, setGiftCardCode] = useState("");
  const [showCodeBox, setShowCodeBox] = useState(false);
  const [useBalance, setUseBalance] = useState(false);
  const [wallet, setWallet] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);

  // The shopper's gift balance, so checkout can offer it and show what is
  // about to be spent. Failures are silent: checkout still works by code.
  useEffect(() => {
    if (!user?.email) { setWallet(null); return; }
    let live = true;
    getWallet().then(({ ok, data }) => {
      if (live && ok && data.success) setWallet(data);
    });
    return () => { live = false; };
  }, [user?.email]);

  // Offers quote themselves as you type (3+ chars) or when the balance is
  // applied: the server prices the same thing again at placement, so a quote
  // can never become a promise.
  useEffect(() => {
    const coupon = couponCode.trim();
    const gift = giftCardCode.trim();
    if ((coupon && coupon.length < 3) || (gift && gift.length < 3)) return;
    if (!coupon && !gift && !useBalance) { setQuote(null); return; }
    let live = true;
    setQuoting(true);
    quoteCheckout({
      subtotal,
      couponCode: coupon,
      giftCardCode: gift,
      customerEmail: (user?.email || "").toLowerCase(),
      useGiftCard: useBalance,
    }).then(({ ok, data }) => {
      if (!live) return;
      setQuoting(false);
      if (ok && data.success) setQuote(data);
      else setQuote(null);
    });
    return () => { live = false; };
  }, [couponCode, giftCardCode, subtotal, user?.email, useBalance]);

  const walletBalance = Number(wallet?.balance) || 0;

  const effectiveTotal = quote ? quote.total : subtotal;
  const [addrModalOpen, setAddrModalOpen] = useState(false);
  const appliedDefaultRef = useRef(false);
  const [form, setForm] = useState({
    customerName: user?.name || "",
    customerMobile: "",
    paymentMethod: "cod",
    pincode: "",
    address: "",
    city: "",
    state: "",
  });

  // Saved addresses come from the server-backed address book. Manual entry
  // always stays available, so checkout never depends on the book loading.

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // The default (or currently selected) saved address fills the form on
  // its own. Runs once and backs off the moment any field holds typed text,
  // so it can never clobber the shopper's own edits.
  useEffect(() => {
    if (appliedDefaultRef.current) return;
    const current = addressBook.selectedAddress;
    if (!current) return;
    setForm((f) => {
      if (f.address.trim() || f.city.trim() || f.pincode.trim()) {
        appliedDefaultRef.current = true;
        return f;
      }
      return {
        ...f,
        customerName: current.recipient || f.customerName,
        customerMobile: current.phone || f.customerMobile,
        address: [current.line1, current.line2, current.landmark].filter(Boolean).join(", "),
        city: current.city || "",
        state: current.state || "",
        pincode: current.postalCode || "",
      };
    });
    appliedDefaultRef.current = true;
  }, [addressBook.selectedAddress]);

  // Named applySaved, not useSaved: the `use` prefix makes the linter treat
  // this as a hook and rules-of-hooks rejects a hook called from a callback.
  function applySaved(a) {
    setForm((f) => ({
      ...f,
      customerName: a.recipient || f.customerName,
      customerMobile: a.phone || f.customerMobile,
      address: [a.line1, a.line2, a.landmark].filter(Boolean).join(", "),
      city: a.city || "",
      state: a.state || "",
      pincode: a.postalCode || "",
    }));
  }

  async function placeOrder(e) {
    e.preventDefault();
    setSending(true);
    setErr("");
    if (lines.length === 0) {
      setErr("Your cart is empty.");
      setSending(false);
      return;
    }

    const { ok, data } = await placeStoreOrder({
      customerName: form.customerName.trim(),
      customerEmail: (user?.email || "").trim().toLowerCase(),
      customerMobile: form.customerMobile.trim(),
      couponCode: couponCode.trim(),
      giftCardCode: giftCardCode.trim(),
      useGiftCard: useBalance,
      shippingAddress: {
        pincode: form.pincode.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
      },
      paymentMethod: form.paymentMethod,
      ...(selectedBranch ? { branchId: selectedBranch.uuid } : {}),
      items: lines.map((l) => ({
        product_uuid: l.uuid,
        quantity: l.quantity,
        ...(l._variant ? { variant: l._variant } : {}),
        ...(l._variantSku ? { sku: l._variantSku } : {}),
      })),
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
        <button className="sf-link" onClick={onBack}><FiChevronLeft /> Back to cart</button>
        <h2>Checkout</h2>
      </div>

      <div className="sf-checkout-cols">
        <form className="sf-checkout-form" onSubmit={placeOrder}>
          <section className="sf-section">
            <h3><FiUser /> Contact details</h3>
            <div className="sf-row-2">
              <div className="sf-field">
                <label>Recipient name *</label>
                <input className="sf-input" required value={form.customerName} onChange={set("customerName")} placeholder="Who will receive the order" />
              </div>
              <div className="sf-field">
                <label>Mobile</label>
                <PhoneInput
                  name="customerMobile"
                  value={form.customerMobile}
                  onChange={(v) => setForm((f) => ({ ...f, customerMobile: v }))}
                  placeholder="Mobile (optional)"
                  defaultDialCode="+91"
                />
              </div>
            </div>
          </section>

          <section className="sf-section">
            <h3><FiMapPin /> Delivery address</h3>
            {(() => {
              const active = addressBook.selectedAddress;
              return (
                <div className="sf-deliver-to">
                  <div className="sf-deliver-to-txt">
                    <small>{active ? "Delivering to" : "Delivery address"}</small>
                    {active ? (
                      <>
                        <strong>{active.label}{active.recipient ? ` · ${active.recipient}` : ""}</strong>
                        <span>
                          {[active.line1, active.line2].filter(Boolean).join(", ")}
                          {active.city ? `, ${active.city}` : ""}{active.postalCode ? ` — ${active.postalCode}` : ""}
                        </span>
                      </>
                    ) : (
                      <span>No saved address yet — fill the form or add one.</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="sf-btn"
                    onClick={() => { appliedDefaultRef.current = true; setAddrModalOpen(true); }}
                  >
                    {active ? "Change" : "Choose"}
                  </button>
                </div>
              );
            })()}
            <AddressBookModal
              open={addrModalOpen}
              addressBook={addressBook}
              user={user}
              notify={notify}
              onSelect={(entry) => {
                addressBook.selectAddress(entry.id);
                applySaved(entry);
                setAddrModalOpen(false);
              }}
              onClose={() => setAddrModalOpen(false)}
            />
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
            <h3><FiGift /> Offers</h3>
            <div className="sf-row-2">
              <div className="sf-field">
                <label>Coupon code</label>
                <input
                  className="sf-input"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="e.g. DIWALI20"
                />
                {quote?.couponError && <p className="sf-field-error">{quote.couponError}</p>}
                {quote?.coupon && !quote.couponError && (
                  <p className="muted small">✓ {quote.coupon.code} applied</p>
                )}
              </div>
              <div className="sf-field">
                <label>Have a gift card code?</label>
                {showCodeBox ? (
                  <>
                    <input
                      className="sf-input"
                      value={giftCardCode}
                      onChange={(e) => setGiftCardCode(e.target.value.toUpperCase())}
                      placeholder="e.g. GIFT-ABC123"
                      autoFocus
                    />
                    {quote?.giftError && <p className="sf-field-error">{quote.giftError}</p>}
                    {quote?.giftCard && !quote.giftError && (
                      <p className="muted small">✓ {quote.giftCard.code} applied</p>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    className="sf-link-btn"
                    onClick={() => { setShowCodeBox(true); setUseBalance(false); }}
                  >
                    Enter a code
                  </button>
                )}
              </div>
            </div>

            {/* The wallet path: one tap, no code. Sits below the code box so
                the manual option stays reachable for a gift received by someone
                else. */}
            {walletBalance > 0 && (
              <div className={`sf-wallet-cta${useBalance ? " is-on" : ""}`}>
                <input
                  id="use-balance"
                  type="checkbox"
                  checked={useBalance}
                  onChange={(e) => {
                    setUseBalance(e.target.checked);
                    if (e.target.checked) {
                      // A typed code and the wallet are two different ways to
                      // pay; only one can be in play at a time.
                      setGiftCardCode("");
                      setShowCodeBox(false);
                    }
                  }}
                />
                <div className="sf-wallet-cta-txt">
                  <strong>
                    Use my gift balance — {inr(walletBalance)}
                  </strong>
                  <span>
                    Spent automatically from your cards. Anything left over goes
                    on your payment method.
                  </span>
                </div>
              </div>
            )}

            {useBalance && quote?.giftCards?.length > 0 && (
              <p className="muted small" style={{ margin: "10px 2px 0" }}>
                ✓ {inr(quote.giftAmount)} from{" "}
                {quote.giftCards.length === 1
                  ? `card ${quote.giftCards[0].code}`
                  : `${quote.giftCards.length} cards`}
              </p>
            )}
            {quoting && <p className="muted small">Checking offers…</p>}
          </section>

          <section className="sf-section">
            <h3><FiCreditCard /> Payment method</h3>
            {PAYMENT_METHODS.map((m) => (
              <label key={m.id} className={`sf-radio ${form.paymentMethod === m.id ? "on" : ""}`}>
                <input
                  type="radio"
                  name="pm"
                  checked={form.paymentMethod === m.id}
                  onChange={() => setForm((f) => ({ ...f, paymentMethod: m.id }))}
                />
                <FiCreditCard />
                <span>
                  <b>{m.label}</b>
                  <small>{m.hint}</small>
                </span>
              </label>
            ))}
          </section>

          {err && <div className="sf-err">{err}</div>}
          <button className="sf-btn green place" disabled={sending}>
            {sending ? "Placing order…" : `Place order — ${inr(effectiveTotal)}`}
          </button>
        </form>

        <div className="sf-totals sticky">
          <h3>Order summary</h3>
          {lines.map((l) => (
            <div className="sf-totals-row" key={l.lineId}>
              <span>{asText(l.name) || "Product"} × {l.quantity}</span>
              <span>{inr(linePrice(l) * l.quantity)}</span>
            </div>
          ))}
          <div className="sf-totals-row"><span>Subtotal</span><span>{inr(subtotal)}</span></div>
          {quote && quote.discount > 0 && (
            <div className="sf-totals-row"><span>Coupon {quote.coupon ? `(${quote.coupon.code})` : ""}</span><span className="ok-text">−{inr(quote.discount)}</span></div>
          )}
          {quote && quote.giftAmount > 0 && (
            <div className="sf-totals-row"><span>Gift card {quote.giftCard ? `(${quote.giftCard.code})` : ""}</span><span className="ok-text">−{inr(quote.giftAmount)}</span></div>
          )}
          <div className="sf-totals-row"><span>Delivery</span><span className="ok-text">Free</span></div>
          <div className="sf-totals-row grand"><span>Total</span><span>{inr(effectiveTotal)}</span></div>
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

function pillClass(status) {
  if (status === "DELIVERED") return "green";
  if (status === "CANCELLED") return "red";
  return "amber";
}

function OrderTrack({ prefilledOrder, user, onBack, onLogin }) {
  const [result, setResult] = useState(prefilledOrder || null);
  const [fromList, setFromList] = useState(false);
  const [orders, setOrders] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loadingList, setLoadingList] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // A different account (or a fresh login) restarts the view.
  useEffect(() => {
    setResult(prefilledOrder || null);
    setFromList(false);
    setPage(1);
  }, [user?.email, prefilledOrder]);

  // The account's full order history — no order number needed.
  useEffect(() => {
    if (result || !user?.email) return;
    let live = true;
    setLoadingList(true);
    setErr("");
    getMyOrders({ page, limit: 10 }).then(({ ok, data }) => {
      if (!live) return;
      setLoadingList(false);
      if (!ok || !data.success) {
        setErr(data.message || "Could not load your orders.");
        return;
      }
      setOrders(data.orders || []);
      setPages(data.pagination?.pages || 1);
    });
    return () => { live = false; };
  }, [user?.email, page, result]);

  // Row click loads the same guarded detail the search form used to show:
  // the row already carries this account's order number and email.
  async function openOrder(order) {
    setBusy(true);
    setErr("");
    const { ok, data } = await trackStoreOrder(order.order_number, user.email);
    setBusy(false);
    if (!ok) {
      setErr(data.message || "Could not open this order.");
      return;
    }
    setResult({ ...data.order, statusHistory: data.statusHistory || [] });
    setFromList(true);
    window.scrollTo({ top: 0 });
  }

  function backFromDetail() {
    if (fromList) {
      setResult(null);
      setFromList(false);
      return;
    }
    onBack();
  }

  // Customer bill download (guarded by the detail's own order + email).
  async function downloadBill() {
    try {
      const blob = await downloadOrderInvoice(
        result.order_number,
        result.customer_email,
      );
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
      ? new Date(v).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
      : "";

  if (result && result.uuid && result.status) {
    const details = result;
    const stepIdx = ORDER_STEPS.indexOf(details.status);
    return (
      <div>
        <div className="sf-page-title">
          <button className="sf-link" onClick={backFromDetail}>
            <FiChevronLeft /> Back
          </button>
          <h2>Order {details.order_number}</h2>
        </div>

        <div className="sf-track-card">
          <div className="sf-track-meta">
            <div><span>Status</span><b>{STEP_LABELS[details.status] || details.status.replace(/_/g, " ")}</b></div>
            <div><span>Total</span><b>{inr(details.total)}</b></div>
            <div>
              <span>Payment</span>
              <b>{(details.payment_method || "").replace(/_/g, " ").toUpperCase()} · {details.payment_status}</b>
            </div>
            {details.storeName && <div><span>Store</span><b>{details.storeName}</b></div>}
            {details.estimatedDeliveryAt && !["DELIVERED", "CANCELLED"].includes(details.status) && (
              <div><span>Estimated delivery</span><b>By {fmtTime(details.estimatedDeliveryAt)}</b></div>
            )}
            <div>
              <span></span>
              <button className="sf-link" onClick={downloadBill}>⬇ Download Bill (PDF)</button>
            </div>
          </div>

          <div className="sf-timeline">
            {ORDER_STEPS.map((s) => {
              const stIdx = ORDER_STEPS.indexOf(s);
              const done = stepIdx >= 0 && stIdx <= stepIdx;
              const current = s === details.status;
              return (
                <div key={s} className={`sf-step ${done ? "done" : ""} ${current ? "current" : ""}`}>
                  <div className="sf-dot">{done && <span>{current ? "●" : "✓"}</span>}</div>
                  <span>{STEP_LABELS[s]}</span>
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
                  <b>{STEP_LABELS[h.status] || h.status.replace(/_/g, " ")}</b>
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
                      {it.variant && <span className="sf-line-variant">{it.variant}</span>}
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

  if (!user) {
    return (
      <div className="sf-track-form-wrap">
        <div className="sf-page-title">
          <button className="sf-link" onClick={onBack}><FiChevronLeft /> Back to shop</button>
          <h2>My orders</h2>
        </div>
        <div className="sf-empty">
          <FiPackage size={34} />
          <p>Log in to see all your orders in one place.</p>
          <button className="sf-btn primary" onClick={onLogin}><FiLogIn /> Login</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="sf-page-title">
        <button className="sf-link" onClick={onBack}><FiChevronLeft /> Back to shop</button>
        <h2>My orders</h2>
      </div>

      {err && <div className="sf-err">{err}</div>}

      {loadingList ? (
        <div className="sf-orders-table-wrap">
          <table className="sf-orders-table">
            <tbody>
              {Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}><td colSpan={7}><div className="sk sk-l" /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : orders.length === 0 ? (
        <div className="sf-empty">
          <FiPackage size={34} />
          <p>No orders yet — your orders will appear here.</p>
        </div>
      ) : (
        <>
          <div className="sf-orders-table-wrap">
            <table className="sf-orders-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Date</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.uuid} className="sf-order-row" onClick={() => openOrder(o)}>
                    <td><b>{o.order_number}</b></td>
                    <td className="muted">{fmtTime(o.created_at)}</td>
                    <td>{o.itemCount}</td>
                    <td><b>{inr(o.total)}</b></td>
                    <td>
                      <span className={`sf-pill ${pillClass(o.status)}`}>
                        {STEP_LABELS[o.status] || o.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td><FiChevronRight /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="sf-pager">
              <button className="sf-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <FiChevronLeft />
              </button>
              <span className="sf-section-page">Page {page} of {pages}</span>
              <button className="sf-btn" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
                <FiChevronRight />
              </button>
            </div>
          )}
        </>
      )}

      {busy && <div className="sf-toast">Opening order…</div>}
    </div>
  );
}

function OtpPanel({ onLogin }) {
  const [step, setStep] = useState("mobile");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [demoOtp, setDemoOtp] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e) {
    e.preventDefault();
    setErr("");
    const digits = mobile.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) {
      setErr("Enter a valid mobile number.");
      return;
    }
    setBusy(true);
    try {
      const { ok, data } = await requestOtp(mobile.trim());
      if (!ok || !data.success) {
        setErr(data.message || "Could not send OTP.");
        return;
      }
      // Demo mode: the code is returned for testing until an SMS sender is
      // wired in. It is shown once, here, instead of arriving by text.
      setDemoOtp(data.demoOtp || null);
      setStep("code");
    } catch {
      setErr("Unable to connect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e) {
    e.preventDefault();
    setErr("");
    if (!/^\d{6}$/.test(otp.trim())) {
      setErr("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    try {
      const { ok, data } = await verifyOtp(mobile.trim(), otp.trim());
      if (!ok || !data.success) {
        setErr(data.message || "Verification failed.");
        return;
      }
      setStoreToken(data.token);
      if (onLogin) onLogin(data.user || { mobile });
    } catch {
      setErr("Unable to connect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "code") {
    return (
      <form onSubmit={confirm} noValidate>
        {err && <p className="auth-msg error" role="alert">{err}</p>}
        {demoOtp && (
          <p className="auth-msg ok" role="status">
            Demo mode — your code is <b>{demoOtp}</b>
          </p>
        )}
        <AuthField
          label="6-digit code"
          name="otp"
          value={otp}
          onChange={(e) => { setOtp(e.target.value); setErr(""); }}
          placeholder="123456"
          autoComplete="one-time-code"
          inputMode="numeric"
        />
        <button className="auth-submit" type="submit" disabled={busy}>
          {busy && <span className="auth-spinner" aria-hidden="true" />}
          {busy ? "Verifying…" : "Verify & log in"}
        </button>
        <div className="auth-foot">
          <p>
            Wrong number?{" "}
            <button type="button" className="sf-link" onClick={() => { setStep("mobile"); setOtp(""); setDemoOtp(null); setErr(""); }}>
              Change mobile number
            </button>
          </p>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={send} noValidate>
      {err && <p className="auth-msg error" role="alert">{err}</p>}
      <div className="sf-field">
        <label>Mobile number</label>
        <PhoneInput
          name="mobile"
          value={mobile}
          onChange={(v) => { setMobile(v); setErr(""); }}
          placeholder="98765 43210"
          defaultDialCode="+91"
        />
      </div>
      <button className="auth-submit" type="submit" disabled={busy}>
        {busy && <span className="auth-spinner" aria-hidden="true" />}
        {busy ? "Sending…" : "Send OTP"}
      </button>
      <div className="auth-foot">
        <p>New numbers get an account automatically on first login.</p>
      </div>
    </form>
  );
}

function AccountPanel({ onBack, onLogin }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((prev) => ({ ...prev, [k]: "" }));
    setErr("");
    setOk("");
  };

  function switchMode(next) {
    setMode(next);
    setErrors({});
    setErr("");
    setOk("");
  }

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setOk("");

    // The storefront panel previously posted whatever it had and rendered
    // whatever the server said. It now uses the same validators as the admin
    // auth screens, so a typo is caught before the round trip.
    const newErrors = {};
    const emailError = validateEmail(form.email.trim());
    const passwordError = validatePassword(form.password);
    if (emailError) newErrors.email = emailError;
    if (passwordError) newErrors.password = passwordError;

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setBusy(true);

    try {
      const email = form.email.trim().toLowerCase();
      const { data } = await storeLogin(email, form.password);

      if (!data.success) {
        setErr(data.message || "Something went wrong");
        return;
      }

      setStoreToken(data.token);
      // Tell the parent so the header switches to the account dropdown
      if (onLogin) onLogin(data.user || { email });
    } catch {
      setErr("Unable to connect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    // auth-root only supplies the shared tokens and field styling. The card
    // shell is deliberately not used here: this panel lives inside the shop
    // page, which brings its own header, background and max-width.
    <div className="auth-root sf-auth-wrap">
      <div className="sf-page-title">
        <button className="sf-link" onClick={onBack}><FiChevronLeft /> Back to shop</button>
        <h2>My account</h2>
      </div>
      <div className="sf-auth">
        <div className="sf-auth-tabs">
          <button className={mode === "login" ? "on" : ""} onClick={() => switchMode("login")}>
            Login
          </button>
          <button className={mode === "otp" ? "on" : ""} onClick={() => switchMode("otp")}>
            Mobile OTP
          </button>
        </div>

        {mode === "otp" && <OtpPanel onLogin={onLogin} />}

        {mode !== "otp" && (
        <form onSubmit={submit} noValidate>
          {err && <p className="auth-msg error" role="alert">{err}</p>}
          {ok && <p className="auth-msg ok" role="status">{ok}</p>}

          <AuthField
            label="Email"
            name="email"
            type="email"
            value={form.email}
            onChange={set("email")}
            error={errors.email}
            placeholder="you@email.com"
            autoComplete="username"
          />

          <AuthField
            label="Password"
            name="password"
            type="password"
            value={form.password}
            onChange={set("password")}
            error={errors.password}
            placeholder="Your password"
            autoComplete="current-password"
          />

          <button className="auth-submit" type="submit" disabled={busy}>
            {busy && <span className="auth-spinner" aria-hidden="true" />}
            {busy ? "Logging in…" : "Login"}
          </button>
        </form>
        )}

        {/* Plain <a>, not react-router <Link>. Storefront is mounted by two
            different entry points: the admin app (inside <BrowserRouter>) and
            storepub, a standalone buyer site that renders <Storefront /> with
            NO router at all. A <Link> needs router context, so it threw
            "Cannot destructure property 'basename' of ... as it is null" on
            storepub. Host-relative anchors need no context and work in both.
            The catch: on storepub these destinations are the host's job to
            serve, since that site defines no /forgot-password route. */}
        <div className="auth-foot">
          {mode === "login" && (
            <a className="auth-forgot" href="/forgot-password">Forgot password?</a>
          )}
          <p>
            Want to open a store?{" "}
            <a href="/register/store">Register your store</a>
          </p>
        </div>
      </div>
    </div>
  );
}

function ProfilePanel({ user, onBack, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: user?.name || "", mobile: user?.mobile || "", email: user?.email || "" });
  // OTP auto-created accounts carry a placeholder address and must swap it
  // for a real one; everyone else's email is immutable (address-link key).
  const emailEditable = (user?.email || "").toLowerCase().endsWith("@mobile.local");
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // Refresh the draft when the account changes underneath the panel.
  useEffect(() => {
    if (!editing) setForm({ name: user?.name || "", mobile: user?.mobile || "", email: user?.email || "" });
  }, [user?.email, editing]);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((prev) => ({ ...prev, [k]: "" }));
    setMsg("");
  };

  async function save(e) {
    e.preventDefault();
    setMsg("");
    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = "Enter your name.";
    if (emailEditable && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      nextErrors.email = "Enter a valid email address.";
    }
    if (form.mobile.trim()) {
      const mobileError = validateMobile(form.mobile.trim());
      if (mobileError) nextErrors.mobile = mobileError;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setBusy(true);
    try {
      const { ok, data } = await updateStoreProfile({
        name: form.name.trim(),
        mobile: form.mobile.trim(),
        ...(emailEditable ? { email: form.email.trim() } : {}),
      });
      if (!ok || !data.success) {
        setErrors(data.errors || {});
        setMsg(data.message || "Could not update profile.");
        return;
      }
      setEditing(false);
      setMsg("Profile updated.");
      if (onUpdate) onUpdate({ ...(user || {}), ...(data.user || {}) });
    } catch {
      setMsg("Unable to connect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-auth-wrap">
      <div className="sf-page-title">
        <button className="sf-link" onClick={onBack}><FiChevronLeft /> Back to shop</button>
        <h2>Account details</h2>
      </div>
      <div className="sf-auth">
        {msg && <p className={errors && Object.keys(errors).length ? "auth-msg error" : "auth-msg ok"} role="status">{msg}</p>}
        {!editing ? (
          <>
            <div className="sf-field">
              <label>Name</label>
              <input className="sf-input" value={user?.name || ""} readOnly />
            </div>
            <div className="sf-field" style={{ marginTop: 12 }}>
              <label>Email</label>
              <input className="sf-input" value={user?.email || ""} readOnly />
            </div>
            <div className="sf-field" style={{ marginTop: 12 }}>
              <label>Mobile</label>
              <input className="sf-input" value={user?.mobile || ""} readOnly placeholder="Not set" />
            </div>
            <button className="sf-btn green" style={{ width: "100%", marginTop: 14, padding: 12 }} onClick={() => { setEditing(true); setForm({ name: user?.name || "", mobile: user?.mobile || "", email: user?.email || "" }); setErrors({}); setMsg(""); }}>
              <FiEdit2 /> Update details
            </button>
          </>
        ) : (
          <form onSubmit={save} noValidate>
            <div className="sf-field">
              <label>Name *</label>
              <input className="sf-input" value={form.name} onChange={set("name")} placeholder="Your name" autoComplete="name" />
              {errors.name && <p className="sf-field-error">{errors.name}</p>}
            </div>
            <div className="sf-field" style={{ marginTop: 12 }}>
              <label>Email{emailEditable ? " *" : " (cannot be changed)"}</label>
              <input
                className="sf-input"
                value={emailEditable ? form.email : user?.email || ""}
                onChange={emailEditable ? (e) => { setForm((f) => ({ ...f, email: e.target.value })); setErrors((prev) => ({ ...prev, email: "" })); setMsg(""); } : undefined}
                readOnly={!emailEditable}
                type="email"
                placeholder={emailEditable ? "you@email.com" : undefined}
                autoComplete="email"
              />
              {emailEditable && <p className="muted small">Add your real email to complete registration.</p>}
              {errors.email && <p className="sf-field-error">{errors.email}</p>}
            </div>
            <div className="sf-field" style={{ marginTop: 12 }}>
              <label>Mobile (used for OTP login)</label>
              <PhoneInput
                name="mobile"
                value={form.mobile}
                onChange={(v) => { setForm((f) => ({ ...f, mobile: v })); setErrors((prev) => ({ ...prev, mobile: "" })); setMsg(""); }}
                placeholder="98765 43210"
                defaultDialCode="+91"
                error={errors.mobile}
              />
            </div>
            <div className="sf-address-actions" style={{ marginTop: 14 }}>
              <button type="button" className="sf-btn" onClick={() => { setEditing(false); setErrors({}); setMsg(""); }} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="sf-btn primary" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function AddressesPanel({ addressBook, notify, onBack }) {
  const [mode, setMode] = useState("list");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(payload) {
    setSaving(true);
    const saved = editing
      ? await addressBook.editAddress(editing.id, payload)
      : await addressBook.saveAddress(payload);
    setSaving(false);
    if (saved) {
      setEditing(null);
      setMode("list");
    }
  }

  return (
    <div className="sf-auth-wrap">
      <div className="sf-page-title">
        <button className="sf-link" onClick={onBack}><FiChevronLeft /> Back to shop</button>
        <h2>Saved addresses</h2>
      </div>
      {mode === "list" ? (
        <>
          <div className="sf-address-list">
            {addressBook.loading && <p className="muted">Loading saved addresses…</p>}
            {addressBook.error && <p className="sf-err">{addressBook.error}</p>}
            {!addressBook.loading && addressBook.addresses.length === 0 && (
              <div className="sf-empty"><p>No saved addresses yet.</p></div>
            )}
            {addressBook.addresses.map((entry) => (
              <div key={entry.id} className="sf-address-row">
                <div className="sf-line-mid">
                  <div className="sf-line-name"><FiMapPin /> {entry.label}{entry.isDefault ? " · Default" : ""}</div>
                  <div className="muted">{[entry.line1, entry.line2, entry.landmark].filter(Boolean).join(", ")}</div>
                  <div className="muted">{entry.city}, {entry.state} — {entry.postalCode} · {entry.phone}</div>
                </div>
                <span className="sf-address-row-actions">
                  <button type="button" className="sf-icon-btn" title="Edit" onClick={() => { setEditing(entry); setMode("form"); }}><FiEdit2 /></button>
                  <button type="button" className="sf-icon-btn" title="Delete" onClick={() => addressBook.removeAddress(entry.id)}><FiTrash2 /></button>
                </span>
              </div>
            ))}
          </div>
          <button type="button" className="sf-btn green" style={{ width: "100%", marginTop: 14, padding: 12 }} onClick={() => { setEditing(null); setMode("form"); }}>
            <FiPlus /> Add address
          </button>
        </>
      ) : (
        <AddressForm
          initial={editing}
          saving={saving}
          notify={notify}
          onCancel={() => { setEditing(null); setMode("list"); }}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}

// The E-Cards shelf: every denomination the shop sells, with its price and
// any promotion shown up front. Cards bought here are redeemable in this
// store, so the balance lands in the buyer's wallet on delivery.
function ECardsShelf({ onBack, onBuy, onViewWallet }) {
  const [items, setItems] = useState(null);
  const [balance, setBalance] = useState(null);
  const [balanceCardCount, setBalanceCardCount] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getDenominations().then(({ ok, data }) => {
      if (!live) return;
      if (ok && data.success) setItems(data.denominations || []);
      else setFailed(true);
    });
    // The balance is only known for a signed-in shopper, so its absence is
    // normal here and must not be treated as an error.
    getWallet().then(({ ok, data }) => {
      if (!live || !ok || !data.success) return;
      setBalance(Number(data.balance) || 0);
      setBalanceCardCount(Number(data.cardCount) || 0);
    });
    return () => { live = false; };
  }, []);

  return (
    <div className="sf-buy" style={{ maxWidth: 900 }}>
      <div className="sf-page-title">
        <button className="sf-link" onClick={onBack}><FiChevronLeft /> Back to shop</button>
      </div>

      <div className="sf-ecards-head">
        <div>
          <h2>Buy a gift card</h2>
          <p>
            Amounts available to buy. Each is a brand new card, delivered by
            email the moment you pay — these are not the cards you already own.
          </p>
        </div>
      </div>

      {/* The balance and the shelf were easy to confuse, so both are named
          explicitly and linked to each other. */}
      <div className="sf-ecards-balance">
        <div>
          <span className="sf-label">Your gift balance</span>
          <strong>{balance == null ? "—" : inr(balance)}</strong>
          <span className="muted small">
            {balance == null
              ? "Sign in to see it"
              : balance > 0
                ? `from ${balanceCardCount} card${balanceCardCount === 1 ? "" : "s"} you already own`
                : "you have no cards yet"}
          </span>
        </div>
        <button type="button" className="sf-btn ghost" onClick={onViewWallet}>
          View my cards
        </button>
      </div>

      {items === null && !failed && (
        <div className="sf-empty"><div className="sf-spinner" /></div>
      )}

      {failed && (
        <div className="sf-empty">
          <FiAlertTriangle size={28} />
          <p>Gift cards could not be loaded right now.</p>
        </div>
      )}

      {items !== null && items.length === 0 && (
        <div className="sf-empty">
          <FiGift size={30} />
          <p>No gift cards are on sale at the moment.</p>
          <p className="muted small">Please check back soon.</p>
        </div>
      )}

      {items != null && items.length > 0 && (
        <div className="sf-ecard-grid">
          {items.map((d) => (
            <div className="sf-ecard" key={d.uuid}>
              {d.discounted && (
                <span className="sf-ecard-flag save">{d.discount_percent}% OFF</span>
              )}
              <span className="sf-ecard-flag">INSTANT</span>
              <img
                className="sf-ecard-art"
                src={giftCardImage({ label: d.label, amount: d.face_value })}
                alt={`${d.label} worth ${d.face_value}`}
              />
              <div className="sf-ecard-face">{inr(d.face_value)}</div>
              {d.discounted && <div className="sf-ecard-mrp">{inr(d.face_value)}</div>}
              <div className="sf-ecard-meta">
                <FiClock /> {d.valid_for_days ? `${d.valid_for_days} days validity` : "No expiry"}
              </div>
              <div className="sf-ecard-buy">
                <button className="sf-btn primary" onClick={() => onBuy(d)}>
                  Buy {inr(d.selling_price)}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// The chips come from the shop's live catalogue. These are the bounds for a
// custom amount, which pays face value.
const GC_MIN = 100;
const GC_MAX = 50000;
const GC_MAX_QTY = 20;
// Quick-pick quantities. 1 is the common case; the rest save typing.
const GC_QTY_CHIPS = [1, 2, 5, 10];
const GC_MSG_MAX = 300;

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Buy a gift card. Four steps: amount, recipient, message, when to send.
function BuyGiftCard({ onBack, onDone, initialDenomination = null, onConsumeDenomination }) {
  const [picked, setPicked] = useState(initialDenomination?.uuid || null);
  const [custom, setCustom] = useState("");
  const [qty, setQty] = useState(1);
  const [showCustom, setShowCustom] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [when, setWhen] = useState("now");
  const [date, setDate] = useState(todayPlus(1));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState("");
  const [catalogue, setCatalogue] = useState([]);
  const [customLabel, setCustomLabel] = useState("Gift Card");
  const [customImage, setCustomImage] = useState("");

  // The chips are the shop's live catalogue, so a retired denomination cannot
  // still be bought from a stale page.
  useEffect(() => {
    let live = true;
    getDenominations().then(({ ok, data }) => {
      if (live && ok && data.success) setCatalogue(data.denominations || []);
    });
    return () => { live = false; };
  }, []);

  // The chosen card comes from the shelf when arriving with one, otherwise from
  // the live catalogue. A custom amount has neither, so it falls back to a
  // generic label and no art.
  const chosenDenom =
    initialDenomination || catalogue.find((d) => d.uuid === picked) || null;

  // A chosen catalogue denomination fixes both what the card is worth and what
  // it costs. Typing a custom amount means the shopper pays face value.
  const amount = chosenDenom ? chosenDenom.face_value : Number(custom) || 0;
  const price = chosenDenom ? chosenDenom.selling_price : Number(custom) || 0;
  // Each card is separate, so a batch is a multiple of one card's value.
  const totalValue = amount * qty;
  const totalPay = price * qty;
  const sendLater = when === "later";

  const denominationLabel = chosenDenom?.label || customLabel || "Gift Card";
  const imageUrl = chosenDenom?.image_url || customImage || null;
  const scopeText = chosenDenom?.scope || "";

  // Leaving the catalogue means a custom amount, which clears the choice so the
  // back button lands on the shelf rather than a half-finished preset.
  // Choosing a catalogue card, or leaving the catalogue for a custom amount.
  function pickDenom(uuid) {
    setPicked(uuid);
    setCustom("");
    setShowCustom(false);
    onConsumeDenomination?.();
    setErrors((p) => ({ ...p, amount: "" }));
  }
  function pickCustom(value) {
    setCustom(value);
    setPicked(null);
    onConsumeDenomination?.();
    setErrors((p) => ({ ...p, amount: "" }));
  }
  function openCustom() {
    setPicked(null);
    setShowCustom(true);
    onConsumeDenomination?.();
    setErrors((p) => ({ ...p, amount: "" }));
  }

  async function submit() {
    const next = {};
    if (!(amount >= GC_MIN && amount <= GC_MAX)) {
      next.amount = `Choose an amount between ${inr(GC_MIN)} and ${inr(GC_MAX)}.`;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = "Enter a valid email address.";
    }
    if (sendLater && !date) {
      next.date = "Pick the date to send it on.";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    setFailure("");
    try {
      const { ok, data } = await purchaseGiftCard({
        denominationUuid: chosenDenom?.uuid || null,
        quantity: qty,
        label: denominationLabel,
        imageUrl,
        amount,
        recipientName: name.trim() || null,
        recipientEmail: email.trim().toLowerCase(),
        recipientPhone: phone.replace(/\D/g, "") || null,
        message: message.trim() || null,
        sendLater,
        ...(sendLater ? { scheduledFor: new Date(`${date}T09:00:00`).toISOString() } : {}),
        paymentMethod: "stripe_sandbox",
      });
      if (!ok || !data.success) {
        setFailure(data?.message || "Could not complete the purchase.");
        return;
      }
      setResult(data);
    } catch {
      setFailure("Unable to connect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const scheduled = Boolean(result.scheduled);
    return (
      <div className="sf-buy">
        <div className="sf-empty" style={{ padding: "30px 16px 10px" }}>
          <FiCheckCircle size={34} style={{ color: "var(--sf-ac)" }} />
          <p style={{ fontSize: 19, fontWeight: 700, color: "var(--sf-ink)" }}>
            {scheduled
              ? `${result.scheduled?.amount ? inr(result.scheduled.amount) : ""} gift card${
                  result.giftCard?.quantity > 1 ? "s" : ""
                } scheduled`.trim()
              : result.giftCard?.quantity > 1
                ? `${result.giftCard.quantity} gift cards sent`
                : "Gift card sent"}
          </p>
          <p className="muted small">
            {scheduled
              ? `It will be emailed to ${result.scheduled.recipientEmail} on the day you chose. Nothing exists yet, so the code cannot be used early.`
              : `Emailed to ${result.giftCard?.recipientEmail || email}.`}
          </p>
        </div>

        {!scheduled && result.giftCard?.code && (
          <div className="sf-preview" style={{ textAlign: "center" }}>
            <div className="sf-preview-to">
              {result.giftCard.codes?.length > 1
                ? `These ${result.giftCard.codes.length} codes — shown only once`
                : "The code — this is the only time it is shown"}
            </div>
            {result.giftCard.codes?.length > 1 ? (
              <ul className="sf-codes">
                {result.giftCard.codes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : (
              <div
                className="sf-preview-amt"
                style={{ fontFamily: "ui-monospace, Menlo, monospace" }}
              >
                {result.giftCard.code}
              </div>
            )}
            <div className="sf-preview-to">
              {inr(result.giftCard.totalPaid ?? result.giftCard.sellingPrice)}
              {result.giftCard.discounted
                ? ` · ${result.giftCard.quantity} × ${inr(result.giftCard.sellingPrice)}`
                : ""}
            </div>
            {!result.emailSent && (
              <div className="sf-preview-msg">
                The email could not be sent, so copy the code above now.
              </div>
            )}
          </div>
        )}

        <button className="sf-btn primary" style={{ width: "100%", padding: 12 }} onClick={onDone}>
          {scheduled ? "Back to my gift balance" : "Done"}
        </button>
      </div>
    );
  }

  return (
    <div className="sf-buy">
      <div className="sf-page-title">
        <button className="sf-link" onClick={onBack}><FiChevronLeft /> Back to shop</button>
        <h2>Buy a gift card</h2>
      </div>

      {failure && <p className="auth-msg error" role="status">{failure}</p>}

      <div className="sf-demo-note">
        <FiAlertTriangle />
        <span>
          <b>Demo mode.</b> No payment provider is connected, so this will not
          take any money. A real card would be charged and the gift card issued
          by the gateway's confirmation.
        </span>
      </div>

      <div className="sf-buy-cols">
        <div>
      {/* 1 — amount */}
      <div className="sf-gstep">
        <div className="sf-gstep-head">
          <span className="sf-gstep-num">1</span>
          <div>
            <h3>Choose an amount</h3>
            <p>Pick a preset, or enter any amount you like.</p>
          </div>
        </div>
        {initialDenomination ? (
          <>
            <div className="sf-qty-row">
              <div>
                <label className="sf-label">How many cards?</label>
                <div className="sf-qty">
                  <button
                    type="button"
                    onClick={() => setQty((n) => Math.max(1, n - 1))}
                    disabled={qty <= 1}
                    aria-label="One fewer card"
                  >
                    −
                  </button>
                  <output aria-live="polite">{qty}</output>
                  <button
                    type="button"
                    onClick={() => setQty((n) => Math.min(GC_MAX_QTY, n + 1))}
                    disabled={qty >= GC_MAX_QTY}
                    aria-label="One more card"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="sf-qty-chips">
                {GC_QTY_CHIPS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`sf-chip${qty === n ? " on" : ""}`}
                    onClick={() => setQty(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            {qty > 1 && (
              <p className="sf-field-hint" style={{ marginTop: 8 }}>
                {qty} separate cards, {inr(initialDenomination.face_value)} each. Each
                code works on its own.
              </p>
            )}

            <div className="sf-amount-tiles">
              <div className="sf-amount-tile on" aria-current="true">
                <span className="sf-amount-face">{inr(initialDenomination.face_value)}</span>
                {initialDenomination.discounted ? (
                  <span className="sf-amount-price">
                    {inr(initialDenomination.selling_price)}{" "}
                    <em>{initialDenomination.discount_percent}% off</em>
                  </span>
                ) : (
                  <span className="sf-amount-price">One price, no discount</span>
                )}
              </div>
            </div>
            <button type="button" className="sf-link-btn" onClick={openCustom}>
              Choose a different amount
            </button>
          </>
        ) : catalogue.length > 0 ? (
          <>
            <div className="sf-qty-row">
              <div>
                <label className="sf-label">How many cards?</label>
                <div className="sf-qty">
                  <button
                    type="button"
                    onClick={() => setQty((n) => Math.max(1, n - 1))}
                    disabled={qty <= 1}
                    aria-label="One fewer card"
                  >
                    −
                  </button>
                  <output aria-live="polite">{qty}</output>
                  <button
                    type="button"
                    onClick={() => setQty((n) => Math.min(GC_MAX_QTY, n + 1))}
                    disabled={qty >= GC_MAX_QTY}
                    aria-label="One more card"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="sf-qty-chips">
                {GC_QTY_CHIPS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`sf-chip${qty === n ? " on" : ""}`}
                    onClick={() => setQty(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="sf-amount-tiles">
              {catalogue.map((d) => (
                <button
                  key={d.uuid}
                  type="button"
                  className={`sf-amount-tile${picked === d.uuid ? " on" : ""}`}
                  onClick={() => pickDenom(d.uuid)}
                  aria-pressed={picked === d.uuid}
                >
                  <span className="sf-amount-face">{inr(d.face_value)}</span>
                  {d.discounted ? (
                    <span className="sf-amount-price">
                      {inr(d.selling_price)} <em>{d.discount_percent}% off</em>
                    </span>
                  ) : (
                    <span className="sf-amount-price">Gift card</span>
                  )}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="sf-link-btn"
              onClick={openCustom}
              style={{ marginTop: 12 }}
            >
              Or enter a different amount
            </button>
          </>
        ) : null}

        {showCustom && (
          <div className="sf-custom-amount">
            <div className="sf-field">
              <label>Value per card (₹) *</label>
              <div className="sf-value-row">
                <input
                  className="sf-input sf-value-input"
                  type="number"
                  min={GC_MIN}
                  max={GC_MAX}
                  value={custom}
                  onChange={(e) => pickCustom(e.target.value)}
                  placeholder={`Min ${inr(GC_MIN)}`}
                />
                <span className="muted small">
                  Minimum {inr(GC_MIN)} · maximum {inr(GC_MAX)}
                </span>
              </div>
            </div>
            <div className="sf-field" style={{ marginTop: 12 }}>
              <label>Card name</label>
              <input
                className="sf-input"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="e.g. Diwali Gift Card"
              />
              <p className="sf-field-hint">
                Shown on the card and in the email.
              </p>
            </div>
            <div className="sf-field" style={{ marginTop: 12 }}>
              <label>Image URL</label>
              <input
                className="sf-input"
                value={customImage}
                onChange={(e) => setCustomImage(e.target.value)}
                placeholder="Optional — blank generates the art"
              />
            </div>
          </div>
        )}

        {errors.amount && <p className="sf-field-error">{errors.amount}</p>}
      </div>

      {/* 2 — recipient */}
      <div className="sf-gstep">
        <div className="sf-gstep-head">
          <span className="sf-gstep-num">2</span>
          <div>
            <h3>Who is it for?</h3>
            <p>The code is emailed to them, so the address has to be right.</p>
          </div>
        </div>
        <div className="sf-field">
          <label>Their name</label>
          <input
            className="sf-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Rohan"
          />
        </div>
        <div className="sf-field" style={{ marginTop: 12 }}>
          <label>Their email *</label>
          <input
            className="sf-input"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setErrors((p) => ({ ...p, email: "" })); }}
            placeholder="rohan@email.com"
          />
          {errors.email && <p className="sf-field-error">{errors.email}</p>}
        </div>
        <div className="sf-field" style={{ marginTop: 12 }}>
          <label>Their phone (optional)</label>
          <input
            className="sf-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="98765 43210"
          />
        </div>
      </div>

      {/* 3 — message */}
      <div className="sf-gstep">
        <div className="sf-gstep-head">
          <span className="sf-gstep-num">3</span>
          <div>
            <h3>Add a message</h3>
            <p>It appears at the top of their email.</p>
          </div>
        </div>
        <textarea
          className="sf-input"
          rows={3}
          maxLength={GC_MSG_MAX}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Happy birthday! Enjoy it."
        />
        <p className={`sf-msg-count${message.length >= GC_MSG_MAX ? " is-full" : ""}`}>
          {message.length}/{GC_MSG_MAX}
        </p>
      </div>

      {/* 4 — when */}
      <div className="sf-gstep">
        <div className="sf-gstep-head">
          <span className="sf-gstep-num">4</span>
          <div>
            <h3>When should it arrive?</h3>
            <p>Send it now, or time it for a birthday.</p>
          </div>
        </div>
        <div className="sf-when">
          <button
            type="button"
            className={`sf-when-opt${!sendLater ? " on" : ""}`}
            onClick={() => setWhen("now")}
          >
            Send now
          </button>
          <button
            type="button"
            className={`sf-when-opt${sendLater ? " on" : ""}`}
            onClick={() => setWhen("later")}
          >
            <FiCalendar style={{ verticalAlign: "-2px", marginRight: 4 }} />
            Send later
          </button>
        </div>
        {sendLater && (
          <input
            className="sf-input"
            type="date"
            min={todayPlus(1)}
            value={date}
            onChange={(e) => { setDate(e.target.value); setErrors((p) => ({ ...p, date: "" })); }}
          />
        )}
        {errors.date && <p className="sf-field-error">{errors.date}</p>}
      </div>

        {/* Pay lives with the steps; the running summary is on the right. */}
        </div>

        <aside className="sf-buy-side">
          <div className="sf-preview">
            {/* Art is a compact preview, not the page's main event. */}
            <img
              className="sf-preview-art"
              src={giftCardImage({
                imageUrl,
                label: denominationLabel,
                amount,
                scope: scopeText,
              })}
              alt="Gift card preview"
            />
            <div className="sf-preview-to">
              {qty > 1
                ? `${qty} gift cards for ${name.trim() || "them"}`
                : `A gift card for ${name.trim() || "them"}`}
            </div>
            <div className="sf-preview-amt">
              {inr(totalValue)}
              {price < amount && <span className="sf-preview-mrp">{inr(amount * qty)}</span>}
            </div>
            {qty > 1 && (
              <div className="sf-preview-to">
                {inr(amount)} each · {qty} × {inr(amount)}
              </div>
            )}
            <div className="sf-preview-to">
              {email.trim() ? `To ${email.trim()}` : "Add their email to send it"}
            </div>
            {message.trim() && <div className="sf-preview-msg">"{message.trim()}"</div>}
            {sendLater && (
              <div className="sf-preview-when">
                <FiClock /> Sends on{" "}
                {new Date(`${date}T09:00:00`).toLocaleDateString("en-IN", {
                  dateStyle: "medium",
                })}
              </div>
            )}

            <div className="sf-buy-summary">
              <span>
                Total
                {price < amount && (
                  <span className="muted small" style={{ marginLeft: 6 }}>
                    you save {inr(totalValue - totalPay)}
                  </span>
                )}
              </span>
              <b>{inr(totalPay)}</b>
            </div>

            <button
              className="sf-btn primary"
              style={{ width: "100%", padding: 13, fontSize: 15 }}
              onClick={submit}
              disabled={busy}
            >
              {busy
                ? "Working…"
                : sendLater
                  ? `Schedule ${qty} gift ${qty === 1 ? "card" : "cards"} — ${inr(totalPay)}`
                  : `Complete purchase — ${inr(totalPay)}`}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

// The shopper's gift balance. One headline figure, with the cards behind it
// listed underneath so the number is never a mystery. Cards the shopper
// cannot use right now still show up, but faded and kept out of the total.
//
// Money lives in two systems — legacy gift_cards rows and the v2 wallet buckets
// a redeemed code opens — and the headline is the sum of both, because the
// shopper did not choose which one paid them. The two halves are broken out
// beneath it, because a bucket's scope is the one thing a single figure hides:
// "₹500" that may only buy spices is not the same offer as "₹500" that buys
// anything, and the shopper is entitled to know before they fill a basket.
function WalletPanel({ onBack, onShop, onBuyCards }) {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [code, setCode] = useState("");
  // The last preview, tagged with the code it answers. Tagging rather than
  // clearing is what keeps a late answer for a code the field no longer holds
  // from being shown against whatever the shopper has typed since.
  const [probe, setProbe] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState(null);

  // Stable, so the mount effect has no moving part in its dependency list, and
  // read and apply are separate so the refetch after a claim can decide what a
  // failed read means without re-deciding what a refused load looks like.
  const readWallet = useCallback(async () => {
    const { ok, data } = await getWallet();
    if (ok && data.success) return { wallet: data, error: "" };
    return { wallet: null, error: (data && data.message) || "Could not load your balance." };
  }, []);

  const applyWallet = useCallback((result) => {
    setLoading(false);
    if (result.wallet) {
      setWallet(result.wallet);
    } else {
      setError(result.error);
    }
  }, []);

  useEffect(() => {
    let live = true;
    readWallet().then((result) => {
      if (!live) return;
      applyWallet(result);
    });
    return () => {
      live = false;
    };
  }, [readWallet, applyWallet]);

  // Preview as they type, debounced: a lookup per keystroke would be a lookup
  // per keystroke against the server's guess budget, and the shopper learns
  // nothing until the code stops changing anyway.
  //
  // Nothing is written from this handler, so `probing` and the preview itself
  // are both derived here rather than stored — a stored "checking" flag would
  // need clearing in two more places and would be wrong in one of them.
  const qualifies = code.length >= PREVIEW_MIN_CHARS;
  const probing = qualifies && (!probe || probe.for !== code);
  const preview = qualifies && probe && probe.for === code ? probe.result : null;

  useEffect(() => {
    if (code.length < PREVIEW_MIN_CHARS) return undefined;
    // A code in the printed GIFT-XXXX-XXXX shape is finished, so it is asked
    // about at once; anything shorter waits for the shopper to stop typing.
    const delay = CODE_SHAPE.test(code) ? 0 : PREVIEW_DEBOUNCE_MS;
    let live = true;
    const timer = setTimeout(async () => {
      const { ok, data } = await previewGiftCardCode(code);
      if (!live) return;
      // A refused preview (throttled, or a fault) has nothing to say about the
      // code, so it clears the caption rather than showing a stale answer.
      setProbe({ for: code, result: ok && data ? data : null });
    }, delay);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [code]);

  const balance = Number(wallet?.balance) || 0;
  const legacyBalance = Number(wallet?.legacyBalance) || 0;
  const v2Balance = Number(wallet?.v2Balance) || 0;
  const cards = wallet?.cards || [];
  const buckets = wallet?.buckets || wallet?.walletBuckets || [];
  const spendable = cards.filter((c) => c.spendable);
  const fmtDate = (v) =>
    v ? new Date(v).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "No expiry";
  // The headline is one number; this is the sentence underneath it, and it names
  // only the systems that actually hold something. "₹0 from 0 gift cards" beside
  // a real balance reads as a bug rather than as an empty half.
  const sources = [
    ...(legacyBalance > 0
      ? [`${inr(legacyBalance)} from ${spendable.length} gift ${spendable.length === 1 ? "card" : "cards"}`]
      : []),
    ...(v2Balance > 0 ? [`${inr(v2Balance)} from ${buckets.length} redeemed`] : []),
  ];

  async function redeem(event) {
    event.preventDefault();
    // The disabled button is what stops a double-click; this is the same rule
    // for the case where two submits land before the first re-renders.
    if (claiming || !code) return;
    setClaiming(true);
    setRedeemMsg(null);

    const { ok, data } = await claimGiftCardCode(code);
    setClaiming(false);

    if (ok && data && data.success) {
      setRedeemMsg({ ok: true, text: data.message });
      // Cleared only here: a code that failed stays in the box so it does not
      // have to be retyped, and one that worked has no further use.
      setCode("");
      setProbe(null);
      // The claim opened a bucket and moved the balance server-side, so the
      // figure on screen is stale until the wallet is read again. A read that
      // fails here is deliberately not turned into an error banner: the claim
      // did succeed, and its confirmation is the more important message.
      const refreshed = await readWallet();
      if (refreshed.wallet) setWallet(refreshed.wallet);
      return;
    }

    // 404, 409, 410 and 429 all land here and the server's own sentence is
    // shown verbatim. It distinguishes "no such code" from "already claimed"
    // and from "expired" deliberately, and paraphrasing it here would throw
    // that away. A 429 is a lockout, so nothing is retried automatically.
    setRedeemMsg({ ok: false, text: (data && data.message) || "Could not add this gift card to your wallet." });
    // The preview for this code is no longer true — it either cannot be claimed,
    // or the server would not have said yes — so it is cleared rather than left
    // contradicting the refusal above the box.
    setProbe({ for: code, result: null });
  }

  if (loading) {
    return (
      <div className="sf-wallet">
        <div className="sf-empty">
          <div className="sf-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="sf-wallet">
      <div className="sf-page-title">
        <button className="sf-link" onClick={onBack}><FiChevronLeft /> Back to shop</button>
        <h2>Your gift balance</h2>
      </div>

      {error && <p className="auth-msg error" role="status">{error}</p>}

      <div className={`sf-wallet-hero${balance > 0 ? "" : " is-empty"}`}>
        <span className="sf-wallet-label"><FiGift /> Available balance</span>
        <div className="sf-wallet-amount">{inr(balance)}</div>
        <div className="sf-wallet-sub">
          {balance > 0
            ? `${sources.join(" · ")} — used automatically at checkout`
            : "No gift balance available right now"}
        </div>
      </div>

      {balance > 0 && (
        <div className="sf-wallet-cta">
          <div className="sf-wallet-cta-txt">
            <strong>Pay with your balance at checkout</strong>
            <span>
              We spend it for you automatically — no code to type. Anything left
              over is charged to your payment method.
            </span>
          </div>
          <button className="sf-btn primary" onClick={onShop}>Start shopping</button>
        </div>
      )}

      {/* Always shown, not only when there is money: right now nobody has a
          wallet, so this box is the only way onto this page that ends with a
          balance. */}
      <div className="sf-wallet-cta">
        <div className="sf-wallet-cta-txt">
          <strong>Have a gift card code?</strong>
          <span>
            Enter the code from your gift card email and we will add it to your
            balance straight away.
          </span>
        </div>
        <form className="sf-redeem-form" onSubmit={redeem}>
          <input
            className="sf-input"
            value={code}
            onChange={(e) => setCode(normalizeRedeemCode(e.target.value))}
            placeholder="GIFT-XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label="Gift card code"
          />
          <button className="sf-btn primary" type="submit" disabled={claiming || !code}>
            {claiming ? "Adding…" : "Redeem"}
          </button>
        </form>
      </div>

      {probing && (
        <p className="auth-msg muted" role="status">Checking that code…</p>
      )}
      {preview && (
        preview.claimable ? (
          <p className="auth-msg ok" role="status">
            <FiCheckCircle />
            <span>
              {preview.message} <strong>{inr(preview.faceValue)}</strong>
              {preview.scopeLabel ? ` · ${preview.scopeLabel}` : ""}
            </span>
          </p>
        ) : (
          <p className="auth-msg error" role="status">
            <FiAlertTriangle />
            <span>{preview.message}</span>
          </p>
        )
      )}
      {redeemMsg && (
        <p className={redeemMsg.ok ? "auth-msg ok" : "auth-msg error"} role="status">
          {redeemMsg.ok ? <FiCheckCircle /> : <FiAlertTriangle />}
          <span>{redeemMsg.text}</span>
        </p>
      )}

      {cards.length > 0 ? (
        <>
          <div className="sf-wallet-list-head">
            <h3>Your cards</h3>
            <span>{inr(legacyBalance)} · {cards.length} total</span>
          </div>
          <div className="sf-wallet-list">
            {cards.map((c) => (
              <WalletCard key={c.uuid} card={c} fmtDate={fmtDate} />
            ))}
          </div>
        </>
      ) : (
        balance <= 0 && !error && (
          <div className="sf-empty">
            <FiGift size={30} />
            <p>You don't have any gift cards yet.</p>
            <p className="muted small">
              They arrive by email, and any balance you have shows up here and is
              spent automatically at checkout.
            </p>
            <button className="sf-btn primary" onClick={onShop}>Browse the store</button>
            {onBuyCards && (
              <button className="sf-btn ghost" onClick={onBuyCards}>
                <FiSend /> Buy a gift card
              </button>
            )}
          </div>
        )
      )}

      {buckets.length > 0 && (
        <>
          <div className="sf-wallet-list-head">
            <h3>Redeemed cards</h3>
            <span>{inr(v2Balance)} · {buckets.length} total</span>
          </div>
          <div className="sf-wallet-list">
            {buckets.map((b) => (
              <WalletBucket key={b.id} bucket={b} fmtDate={fmtDate} />
            ))}
          </div>
        </>
      )}

      <p className="sf-note">
        Only the last four characters are shown, for your security. The full code
        is in the email you received and is not something we can display again.
      </p>
    </div>
  );
}

// One v2 bucket: the remainder of a code the shopper has already redeemed.
// Its scope is printed whether or not it is restricted, because "All products"
// is the answer to "what may this buy" too — and a restricted bucket that
// looked like plain money is how someone finds out at the till.
function WalletBucket({ bucket, fmtDate }) {
  const left = Number(bucket.balance) || 0;
  const scope = bucket.scopeLabel || "All products";

  return (
    <div className="sf-gift-card">
      <div className="sf-gift-icon"><FiGift /></div>
      <div className="sf-gift-main">
        <div className="sf-gift-top">
          <span className="sf-gift-code">Gift card #{bucket.id}</span>
          {bucket.expiresAt ? (
            <span className="sf-pill warn">Expires {fmtDate(bucket.expiresAt)}</span>
          ) : (
            <span className="sf-pill ok">No expiry</span>
          )}
        </div>
        <div className="sf-gift-meta">
          {inr(left)} available
          {` · ${bucket.expiresAt ? `Expires ${fmtDate(bucket.expiresAt)}` : "No expiry"}`}
        </div>
        <div className="sf-gift-meta" style={{ marginTop: 2 }}>
          <FiTag /> {scope}
        </div>
      </div>
      <div className="sf-gift-amt">{inr(left)}</div>
    </div>
  );
}

// One card in the wallet, with a bar showing how much of it is left.
function WalletCard({ card, fmtDate }) {
  const total = Number(card.initial_amount) || 0;
  const left = Number(card.balance) || 0;
  const pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
  const low = pct > 0 && pct <= 25;

  let pill = null;
  if (card.status === "SUSPENDED") {
    pill = <span className="sf-pill warn">Suspended</span>;
  } else if (card.status === "CANCELLED") {
    pill = <span className="sf-pill bad">Cancelled</span>;
  } else if (card.status === "EXPIRED") {
    pill = <span className="sf-pill bad">Expired</span>;
  } else if (card.status === "REDEEMED" || left <= 0) {
    pill = <span className="sf-pill">Used up</span>;
  } else if (card.usesRemaining != null && card.usesRemaining <= 1) {
    pill = <span className="sf-pill warn">{card.usesRemaining} use left</span>;
  } else if (card.expires_at) {
    pill = <span className="sf-pill ok">Active</span>;
  } else {
    pill = <span className="sf-pill ok">Active</span>;
  }

  return (
    <div className={`sf-gift-card${card.spendable ? "" : " is-spent"}`}>
      <img
        className="sf-gift-art"
        src={giftCardImage({
          imageUrl: card.image_url,
          label: card.label,
          amount: card.initial_amount,
          scope: card.scope,
        })}
        alt=""
      />
      <div className="sf-gift-main">
        <div className="sf-gift-top">
          <span className="sf-gift-code">{card.code}</span>
          {pill}
        </div>
        <div className="sf-gift-meta">
          {inr(left)} of {inr(total)} left
          {Number(card.spent) > 0 ? ` · ${inr(card.spent)} used` : ""}
          {` · ${card.expires_at ? `Expires ${fmtDate(card.expires_at)}` : "No expiry"}`}
        </div>
        {card.scope && card.scope !== "Any product" && (
          <div className="sf-gift-meta" style={{ marginTop: 2 }}>
            <FiTag /> {card.scope} only
          </div>
        )}
        {total > 0 && (
          <div className={`sf-gift-bar${low ? " is-low" : ""}`}>
            <i style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="sf-gift-amt">{inr(left)}</div>
    </div>
  );
}
