import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getGiftCard,
  createGiftCard,
  updateGiftCard,
} from "../services/giftCards";
import Breadcrumb from "./Breadcrumb";
import { GIFT_CARD_STATUS, formatCurrency } from "@shared/constants";
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

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let tail = "";
  for (let i = 0; i < 6; i++) {
    tail += chars[Math.floor(Math.random() * chars.length)];
  }
  return `GIFT-${tail}`;
}

export default function GiftCardForm({ giftCardId = null }) {
  const isEdit = Boolean(giftCardId);
  const { can } = useAuth();
  const canSubmit = can(isEdit ? "gift_cards.update" : "gift_cards.create");
  const navigate = useNavigate();

  const [card, setCard] = useState(null);
  const [form, setForm] = useState({
    code: "",
    amount: "",
    recipientEmail: "",
    expiresAt: "",
    status: GIFT_CARD_STATUS.ACTIVE,
    adjustAmount: "",
  });

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
            amount: c.initial_amount ?? "",
            recipientEmail: c.recipient_email || "",
            expiresAt: toLocalInput(c.expires_at),
            status: c.status || GIFT_CARD_STATUS.ACTIVE,
            adjustAmount: "",
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

  const set = (key) => (e) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: "" }));
    setMessage("");
  };

  async function onSubmit(e) {
    e.preventDefault();
    setMessage("");

    const nextErrors = {};

    if (!form.code.trim()) {
      nextErrors.code = "Code is required.";
    }

    if (!isEdit && !(Number(form.amount) > 0)) {
      nextErrors.amount = "Amount must be greater than zero.";
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
        code: form.code.trim(),
        amount: Number(form.amount),
        recipientEmail: form.recipientEmail.trim() || null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        status: form.status,
      };

      if (isEdit && form.adjustAmount !== "" && Number(form.adjustAmount) !== 0) {
        payload.adjustAmount = Number(form.adjustAmount);
      }

      const data = isEdit
        ? await updateGiftCard(giftCardId, payload)
        : await createGiftCard(payload);

      if (!data.success) {
        setMessage(data.message || "Could not save gift card.");
        return;
      }

      navigate("/gift-cards");
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
                <label className="form-label">Code *</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={form.code}
                    onChange={set("code")}
                    placeholder="GIFT-ABC123"
                    disabled={isEdit}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  {!isEdit && (
                    <button
                      type="button"
                      className="filament-btn filament-btn-secondary"
                      onClick={() => setForm((prev) => ({ ...prev, code: randomCode() }))}
                    >
                      Generate
                    </button>
                  )}
                </div>
                {errors.code && <p className="input-error" style={{ margin: "0.25rem 0 0" }}>{errors.code}</p>}
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
            </div>

            <div className="detail-block">
              <h3>Recipient &amp; validity</h3>
              <div className="form-row">
                <label className="form-label">Recipient email</label>
                <input
                  type="email"
                  value={form.recipientEmail}
                  onChange={set("recipientEmail")}
                  placeholder="buyer@email.com — blank means whoever redeems first"
                />
                {errors.recipientEmail && <p className="input-error" style={{ margin: "0.25rem 0 0" }}>{errors.recipientEmail}</p>}
              </div>
              <div className="form-row" style={{ marginTop: 14 }}>
                <label className="form-label">Expires at</label>
                <input type="datetime-local" value={form.expiresAt} onChange={set("expiresAt")} />
              </div>
              <div className="form-row" style={{ marginTop: 14 }}>
                <label className="form-label">Status</label>
                <select value={form.status} onChange={set("status")}>
                  <option value={GIFT_CARD_STATUS.ACTIVE}>Active</option>
                  <option value={GIFT_CARD_STATUS.INACTIVE}>Inactive</option>
                </select>
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
              </div>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
