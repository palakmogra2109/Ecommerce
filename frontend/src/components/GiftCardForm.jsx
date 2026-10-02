import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getGiftCard,
  createGiftCard,
  updateGiftCard,
  getGiftCardReferences,
} from "../services/giftCards";
import Breadcrumb from "./Breadcrumb";
import {
  GIFT_CARD_STATUS,
  GIFT_CARD_SOURCE,
  formatCurrency,
} from "@shared/constants";
import { giftCardImage } from "../lib/giftCardArt";
import { useAuth } from "../context/AuthContext";

// Converts a timestamptz value to the <input type="datetime-local">
// format local to the browser.
function toLocalInput(value) {
  if (!value) {
    return "";
  }

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return "";
  }

  const pad = (n) => String(n).padStart(2, "0");

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDisplayDate(value) {
  if (!value) {
    return "No limit";
  }

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return "—";
  }

  return d.toLocaleDateString("en-IN", { dateStyle: "medium" });
}

const EMPTY_FORM = {
  code: "",
  label: "Gift Card",
  amount: "",
  recipientEmail: "",
  sendEmail: false,
  expiresAt: "",
  status: GIFT_CARD_STATUS.ACTIVE,
  source: GIFT_CARD_SOURCE.FIXED,
  usageLimit: "",
  minOrderAmount: "",
  maxRedemptionAmount: "",
  adjustAmount: "",
  adjustReason: "",
  imageUrl: "",
  scopeMode: "any",
  scopeCategories: [],
  scopeBrands: [],
  scopeProducts: [],
};

const SCOPE_MODES = [
  { id: "any", label: "Anywhere", hint: "No restrictions" },
  { id: "category", label: "By category", hint: "e.g. Spices" },
  { id: "brand", label: "By brand", hint: "e.g. Nila Organics" },
  { id: "products", label: "Specific items", hint: "Pick products" },
];

export default function GiftCardForm({ giftCardId = null }) {
  const isEdit = Boolean(giftCardId);
  const { can } = useAuth();
  const canSubmit = can(isEdit ? "gift_cards.update" : "gift_cards.create");
  const navigate = useNavigate();

  const [card, setCard] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  // Codes are hash-stored, so a freshly issued card is the only chance the
  // full code is ever visible. Hold it here instead of navigating away.
  const [issued, setIssued] = useState(null);
  const [copied, setCopied] = useState(false);

  const [loading, setLoading] = useState(isEdit);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isEdit) {
      return;
    }

    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        const data = await getGiftCard(giftCardId);

        if (!active) {
          return;
        }

        if (data.success) {
          const c = data.giftCard;
          setCard(c);
          setForm({
            code: c.code || "",
            label: c.label || "Gift Card",
            amount: c.initial_amount ?? "",
            recipientEmail: c.recipient_email || "",
            sendEmail: false,
            expiresAt: toLocalInput(c.expires_at),
            status: c.status || GIFT_CARD_STATUS.ACTIVE,
            source: c.source || GIFT_CARD_SOURCE.FIXED,
            usageLimit: c.usage_limit ?? "",
            minOrderAmount: c.min_order_amount ?? "",
            maxRedemptionAmount: c.max_redemption_amount ?? "",
            adjustAmount: "",
            adjustReason: "",
            imageUrl: c.image_url || "",
            scopeMode:
              (c.applicable_categories || []).length ? "category"
              : (c.applicable_brands || []).length ? "brand"
              : (c.applicable_products || []).length ? "products"
              : "any",
            scopeCategories: c.applicable_categories || [],
            scopeBrands: c.applicable_brands || [],
            scopeProducts: c.applicable_products || [],
          });
        } else {
          setMessage(data.message || "Could not load gift card.");
        }
      } catch {
        if (active) {
          setMessage("Unable to connect. Please try again.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      active = false;
    };
  }, [giftCardId, isEdit]);

  // Brands, categories and products for the scope picker.
  const [refs, setRefs] = useState({ brands: [], categories: [], products: [] });

  useEffect(() => {
    let live = true;
    getGiftCardReferences().then((data) => {
      if (live && data.success) {
        setRefs({
          brands: data.brands || [],
          categories: data.categories || [],
          products: data.products || [],
        });
      }
    });
    return () => { live = false; };
  }, []);

  const set = (key) => (e) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: "" }));
    setMessage("");
  };

  // Chip lists are multi-select; the dropdown above is how one more is added.
  function toggleIn(list, value) {
    const key = list === "scopeCategories" ? "scopeCategories"
      : list === "scopeBrands" ? "scopeBrands" : "scopeProducts";
    setForm((prev) => {
      const current = prev[key];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [key]: next };
    });
  }

  async function onSubmit(e) {
    e.preventDefault();
    setMessage("");

    const nextErrors = {};

    if (!isEdit && !(Number(form.amount) > 0)) {
      nextErrors.amount = "Amount must be greater than zero.";
    }

    if (Number(form.maxRedemptionAmount) > 0 && Number(form.maxRedemptionAmount) > Number(form.amount)) {
      nextErrors.maxRedemptionAmount = "Per-use cap cannot exceed the card value.";
    }

    if (form.recipientEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.recipientEmail.trim())) {
      nextErrors.recipientEmail = "Enter a valid email address.";
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSaving(true);

    try {
      const payload = {
        // Blank means "generate a secure code server-side".
        code: form.code.trim() || null,
        label: form.label.trim() || "Gift Card",
        amount: Number(form.amount),
        recipientEmail: form.recipientEmail.trim() || null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        status: form.status,
        source: form.source,
        usageLimit: form.usageLimit === "" ? null : Number(form.usageLimit),
        minOrderAmount: form.minOrderAmount === "" ? 0 : Number(form.minOrderAmount),
        maxRedemptionAmount: form.maxRedemptionAmount === "" ? null : Number(form.maxRedemptionAmount),
        imageUrl: form.imageUrl.trim() || null,
        sendEmail: form.sendEmail,
        // Only the selected mode is persisted, so a card is never scoped by two
        // rules at once and the shopper-facing wording stays unambiguous.
        applicableCategories: form.scopeMode === "category" ? form.scopeCategories : [],
        applicableBrands: form.scopeMode === "brand" ? form.scopeBrands : [],
        applicableProducts: form.scopeMode === "products" ? form.scopeProducts : [],
      };

      if (isEdit) {
        // Balances are immutable on create and ledgered on edit.
        delete payload.amount;
        if (form.adjustAmount !== "" && Number(form.adjustAmount) !== 0) {
          payload.adjustAmount = Number(form.adjustAmount);
          payload.adjustReason = form.adjustReason.trim() || "Manual adjustment";
        }
      }

      const data = isEdit
        ? await updateGiftCard(giftCardId, payload)
        : await createGiftCard(payload);

      if (!data.success) {
        setMessage(data.message || "Could not save gift card.");
        return;
      }

      if (isEdit) {
        navigate("/gift-cards");
        return;
      }

      // The full code exists in this response only. Show it before leaving.
      setIssued({
        code: data.giftCard?.code,
        amount: data.giftCard?.initial_amount ?? payload.amount,
        assigned: Boolean(data.giftCard?.recipient_email),
        emailed: Boolean(data.emailSent),
      });
    } catch {
      setMessage("Unable to connect. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="filament-page">
        <div className="filament-empty">
          <div className="filament-spinner" />
        </div>
      </div>
    );
  }

  if (issued) {
    return (
      <div className="filament-page">
        <Breadcrumb
          items={[
            { label: "Gift Cards", to: "/gift-cards" },
            { label: "Issued" },
          ]}
        />

        <div className="filament-card">
          <div className="filament-card-header">
            <div className="filament-card-header-left">
              <h1>Gift card issued</h1>
            </div>
            <div className="filament-card-header-right">
              <button
                type="button"
                className="filament-btn filament-btn-primary"
                onClick={() => navigate("/gift-cards")}
              >
                Done
              </button>
            </div>
          </div>

          <div className="filament-pad">
            <div className="filament-alert">
              This is the only time the full code is shown. Copy it now — it is
              stored hashed and cannot be displayed again.
            </div>

            <div className="form-row">
              <label className="form-label">Code</label>
              <div style={{ display: "flex", gap: 8 }}>
                <code className="coupon-code" style={{ flex: 1, minWidth: 0 }}>
                  {issued.code}
                </code>
                <button
                  type="button"
                  className="filament-btn filament-btn-secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(issued.code || "");
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div className="form-row" style={{ marginTop: 14 }}>
              <label className="form-label">Value</label>
              <span>{formatCurrency(Number(issued.amount) || 0)}</span>
            </div>

            <div className="form-row" style={{ marginTop: 14 }}>
              <label className="form-label">Assigned to</label>
              <span>
                {issued.assigned
                  ? "This customer's wallet."
                  : "Nobody yet — anyone with the code can use it."}
              </span>
            </div>
            <div className="form-row" style={{ marginTop: 10 }}>
              <label className="form-label">Code delivery</label>
              <span>
                {issued.emailed
                  ? "Emailed to them."
                  : "Not emailed — share the code above yourself."}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const previewAmount = Number(form.amount) > 0 ? formatCurrency(Number(form.amount)) : "—";
  const spent = card ? Math.max(0, (Number(card.initial_amount) || 0) - (Number(card.balance) || 0)) : 0;

  return (
    <div className="filament-page">
      <Breadcrumb
        items={[
          { label: "Gift Cards", to: "/gift-cards" },
          { label: isEdit ? form.code || "Edit" : "Issue" },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <form className="admin-form admin-form-full" onSubmit={onSubmit}>
        <div className="filament-card">
          <div className="filament-card-header">
            <div className="filament-card-header-left">
              <h1>{isEdit ? form.code || "Edit Gift Card" : "Issue Gift Card"}</h1>
              <span className={`filament-badge filament-badge-${String(form.status || "").toLowerCase()}`}>
                <span className="filament-badge-dot" />
                {form.status}
              </span>
            </div>
            <div className="filament-card-header-right">
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={() => navigate("/gift-cards")}
              >
                ← Back
              </button>
              <button
                type="submit"
                className="filament-btn filament-btn-primary"
                disabled={saving || !canSubmit}
              >
                {saving ? "Saving…" : isEdit ? "Save changes" : "Issue card"}
              </button>
            </div>
          </div>

          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-value">
                {isEdit && card ? formatCurrency(card.balance) : previewAmount}
              </span>
              <span className="stat-label">{isEdit ? "Balance" : "Loaded value"}</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{form.code.trim() || "—"}</span>
              <span className="stat-label">Code</span>
            </div>
            {isEdit && card ? (
              <div className="stat-card">
                <span className="stat-value">{formatCurrency(spent)}</span>
                <span className="stat-label">Spent</span>
              </div>
            ) : (
              <div className="stat-card">
                <span className="stat-value">{form.recipientEmail.trim() || "Anyone"}</span>
                <span className="stat-label">Recipient</span>
              </div>
            )}
            <div className="stat-card">
              <span className="stat-value">{form.expiresAt ? toDisplayDate(form.expiresAt) : "No limit"}</span>
              <span className="stat-label">Expires</span>
            </div>
          </div>

          <div className="detail-grid" style={{ gridTemplateColumns: "1fr" }}>
            <div className="detail-block">
              <h3>Card</h3>
              <div className="form-row">
                <label className="form-label">Code</label>
                <input
                  value={form.code}
                  onChange={set("code")}
                  placeholder="Leave blank to generate a secure code"
                  disabled={isEdit}
                />
                <p className="input-hint">
                  Generated codes use a cryptographically secure alphabet and are
                  stored hashed.
                </p>
              </div>
              <div className="form-row" style={{ marginTop: 14 }}>
                <label className="form-label">Amount (₹) *</label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={form.amount}
                  onChange={set("amount")}
                  placeholder="500"
                  disabled={isEdit}
                />
                {isEdit
                  ? <p className="input-hint">Locked after issue — use the top-up below.</p>
                  : null}
                {errors.amount && <p className="input-error" style={{ margin: "0.25rem 0 0" }}>{errors.amount}</p>}
              </div>
              {!isEdit && (
                <div className="form-row" style={{ marginTop: 14 }}>
                  <label className="form-label">Source</label>
                  <select value={form.source} onChange={set("source")}>
                    <option value={GIFT_CARD_SOURCE.FIXED}>Fixed denomination</option>
                    <option value={GIFT_CARD_SOURCE.CUSTOM}>Custom amount</option>
                    <option value={GIFT_CARD_SOURCE.PROMOTIONAL}>Promotional</option>
                  </select>
                </div>
              )}
            </div>

            <div className="detail-block">
              <h3>Recipient &amp; validity</h3>
              <div className="form-row">
                <label className="form-label">Assign to customer</label>
                <input
                  type="email"
                  value={form.recipientEmail}
                  onChange={set("recipientEmail")}
                  placeholder="Optional — their email, so the card lands in their wallet"
                />
                <p className="input-hint">
                  Attaches the card to that account. It does not send anything
                  to them.
                </p>
                {errors.recipientEmail && <p className="input-error" style={{ margin: "0.25rem 0 0" }}>{errors.recipientEmail}</p>}
              </div>
              {!isEdit && form.recipientEmail.trim() && (
                <div className="form-row" style={{ marginTop: 12 }}>
                  <label className="filament-check">
                    <input
                      type="checkbox"
                      checked={form.sendEmail}
                      onChange={set("sendEmail")}
                    />
                    Email the code to them now
                  </label>
                  <p className="input-hint">
                    Off by default. An issued card is often printed or handed
                    over instead.
                  </p>
                </div>
              )}
              <div className="form-row" style={{ marginTop: 14 }}>
                <label className="form-label">Expires at</label>
                <input type="datetime-local" value={form.expiresAt} onChange={set("expiresAt")} />
              </div>
              <div className="form-row" style={{ marginTop: 14 }}>
                <label className="form-label">Status</label>
                <select value={form.status} onChange={set("status")}>
                  <option value={GIFT_CARD_STATUS.DRAFT}>Draft — not yet usable</option>
                  <option value={GIFT_CARD_STATUS.ACTIVE}>Active</option>
                  <option value={GIFT_CARD_STATUS.SUSPENDED}>Suspended</option>
                  {!isEdit && <option value={GIFT_CARD_STATUS.CANCELLED}>Cancelled</option>}
                </select>
                {isEdit && card?.status === GIFT_CARD_STATUS.REDEEMED && (
                  <p className="input-hint">A fully used card can be revived with a top-up.</p>
                )}
              </div>
            </div>

            <div className="detail-block">
              <h3>Usage limits</h3>
              <div className="form-row">
                <label className="form-label">Times redeemable</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.usageLimit}
                  onChange={set("usageLimit")}
                  placeholder="Blank = unlimited"
                />
              </div>
              <div className="form-row" style={{ marginTop: 14 }}>
                <label className="form-label">Maximum per order (₹)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.maxRedemptionAmount}
                  onChange={set("maxRedemptionAmount")}
                  placeholder="Blank = no cap"
                />
                {errors.maxRedemptionAmount && (
                  <p className="input-error" style={{ margin: "0.25rem 0 0" }}>{errors.maxRedemptionAmount}</p>
                )}
              </div>
              <div className="form-row" style={{ marginTop: 14 }}>
                <label className="form-label">Minimum order (₹)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.minOrderAmount}
                  onChange={set("minOrderAmount")}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="detail-block">
              <h3>Where it can be used</h3>
              <p className="input-hint" style={{ marginTop: 0 }}>
                Leave it Anywhere and the card spends on anything in the store.
              </p>

              <div className="gc-scope-modes">
                {SCOPE_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`gc-scope-mode${form.scopeMode === m.id ? " on" : ""}`}
                    onClick={() =>
                      setForm((prev) => ({ ...prev, scopeMode: m.id }))
                    }
                  >
                    {m.label}
                    <small>{m.hint}</small>
                  </button>
                ))}
              </div>

              {form.scopeMode === "category" && (
                <>
                  <div className="form-row">
                    <label className="form-label">Categories</label>
                    <select
                      value=""
                      onChange={(e) => e.target.value && toggleIn("scopeCategories", e.target.value)}
                    >
                      <option value="">Add a category…</option>
                      {refs.categories
                        .filter((c) => !form.scopeCategories.includes(c.slug))
                        .map((c) => (
                          <option key={c.slug} value={c.slug}>{c.name}</option>
                        ))}
                    </select>
                  </div>
                  <div className="gc-chips">
                    {form.scopeCategories.map((slug) => {
                      const c = refs.categories.find((x) => x.slug === slug);
                      return (
                        <span className="gc-chip" key={slug}>
                          {c?.name || slug}
                          <button type="button" onClick={() => toggleIn("scopeCategories", slug)} aria-label={`Remove ${c?.name || slug}`}>×</button>
                        </span>
                      );
                    })}
                    {form.scopeCategories.length === 0 && (
                      <span className="filament-muted">No categories chosen yet.</span>
                    )}
                  </div>
                </>
              )}

              {form.scopeMode === "brand" && (
                <>
                  <div className="form-row">
                    <label className="form-label">Brands</label>
                    <select
                      value=""
                      onChange={(e) => e.target.value && toggleIn("scopeBrands", e.target.value)}
                    >
                      <option value="">Add a brand…</option>
                      {refs.brands
                        .filter((b) => !form.scopeBrands.includes(String(b.id)))
                        .map((b) => (
                          <option key={b.id} value={String(b.id)}>{b.name}</option>
                        ))}
                    </select>
                  </div>
                  <div className="gc-chips">
                    {form.scopeBrands.map((id) => {
                      const b = refs.brands.find((x) => String(x.id) === id);
                      return (
                        <span className="gc-chip" key={id}>
                          {b?.name || `Brand #${id}`}
                          <button type="button" onClick={() => toggleIn("scopeBrands", id)} aria-label={`Remove ${b?.name || id}`}>×</button>
                        </span>
                      );
                    })}
                    {form.scopeBrands.length === 0 && (
                      <span className="filament-muted">No brands chosen yet.</span>
                    )}
                  </div>
                </>
              )}

              {form.scopeMode === "products" && (
                <>
                  <div className="form-row">
                    <label className="form-label">Filter by brand</label>
                    <select
                      value={refs.brands.find((b) => String(b.id) === form.productBrandFilter)?.id ?? ""}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, productBrandFilter: e.target.value }))
                      }
                    >
                      <option value="">All brands</option>
                      {refs.brands.map((b) => (
                        <option key={b.id} value={String(b.id)}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-row" style={{ marginTop: 12 }}>
                    <label className="form-label">Products</label>
                    <select
                      value=""
                      onChange={(e) => e.target.value && toggleIn("scopeProducts", e.target.value)}
                    >
                      <option value="">Add a product…</option>
                      {refs.products
                        .filter((p) => {
                          if (form.scopeProducts.includes(p.uuid)) return false;
                          if (!form.productBrandFilter) return true;
                          return String(p.brand_id) === String(form.productBrandFilter);
                        })
                        .map((p) => (
                          <option key={p.uuid} value={p.uuid}>{p.name}</option>
                        ))}
                    </select>
                  </div>
                  <div className="gc-chips">
                    {form.scopeProducts.map((uuid) => {
                      const p = refs.products.find((x) => x.uuid === uuid);
                      return (
                        <span className="gc-chip" key={uuid}>
                          {p?.name || uuid.slice(0, 8)}
                          <button type="button" onClick={() => toggleIn("scopeProducts", uuid)} aria-label={`Remove ${p?.name || uuid}`}>×</button>
                        </span>
                      );
                    })}
                    {form.scopeProducts.length === 0 && (
                      <span className="filament-muted">No products chosen yet.</span>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="detail-block">
              <h3>Card image</h3>
              <div className="form-row">
                <label className="form-label">Image URL</label>
                <input
                  value={form.imageUrl}
                  onChange={set("imageUrl")}
                  placeholder="Leave blank to use generated art"
                />
                <p className="input-hint">
                  Blank generates card art from the name and amount, so every card
                  looks finished without an image service.
                </p>
              </div>
              <div className="gc-art-preview" style={{ marginTop: 14 }}>
                <img
                  src={giftCardImage({
                    imageUrl: form.imageUrl,
                    label: form.label?.trim() || "Gift Card",
                    amount: Number(form.amount) || 0,
                    scope:
                      form.scopeMode === "category"
                        ? refs.categories.filter((c) => form.scopeCategories.includes(c.slug)).map((c) => c.name).join(", ")
                        : form.scopeMode === "brand"
                          ? refs.brands.filter((b) => form.scopeBrands.includes(String(b.id))).map((b) => b.name).join(", ")
                          : form.scopeMode === "products"
                            ? `${form.scopeProducts.length} items`
                            : "",
                  })}
                  alt="Gift card preview"
                />
                <span className="filament-muted">Live preview</span>
              </div>
            </div>

            {isEdit && (
              <div className="detail-block">
                <h3>Balance top-up</h3>
                <div className="form-row">
                  <label className="form-label">Adjustment (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.adjustAmount}
                    onChange={set("adjustAmount")}
                    placeholder="e.g. 200 or -50"
                  />
                  <p className="input-hint">Ledgered as an adjustment; history is never edited.</p>
                </div>
                <div className="form-row" style={{ marginTop: 14 }}>
                  <label className="form-label">Reason</label>
                  <input
                    value={form.adjustReason}
                    onChange={set("adjustReason")}
                    placeholder="Why is the balance changing?"
                  />
                  <p className="input-hint">Stored on the ledger entry for audit.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
