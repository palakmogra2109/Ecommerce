import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { bulkCreateGiftCards, downloadGiftCardsCsv } from "../services/giftCards";
import Breadcrumb from "../components/Breadcrumb";
import { GIFT_CARD_STATUS, formatCurrency } from "@shared/constants";
import { useAuth } from "../context/AuthContext";

// Bulk issue: N cards with one shared configuration. Full codes are returned
// exactly once, so this screen must make exporting them the obvious next step.
export default function GiftCardBulkIssue() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canSubmit = can("gift_cards.create");

  const [form, setForm] = useState({
    count: "10",
    amount: "",
    recipientEmail: "",
    expiresAt: "",
    status: GIFT_CARD_STATUS.ACTIVE,
    usageLimit: "",
    minOrderAmount: "",
    maxRedemptionAmount: "",
  });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [issued, setIssued] = useState([]);

  const set = (key) => (e) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: "" }));
    setMessage("");
  };

  async function onSubmit(e) {
    e.preventDefault();
    setMessage("");

    const count = Number(form.count);
    const nextErrors = {};
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      nextErrors.count = "Count must be between 1 and 500.";
    }
    if (!(Number(form.amount) > 0)) {
      nextErrors.amount = "Amount must be greater than zero.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSaving(true);
    try {
      const data = await bulkCreateGiftCards({
        count,
        amount: Number(form.amount),
        recipientEmail: form.recipientEmail.trim() || null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        status: form.status,
        usageLimit: form.usageLimit === "" ? null : Number(form.usageLimit),
        minOrderAmount: form.minOrderAmount === "" ? 0 : Number(form.minOrderAmount),
        maxRedemptionAmount:
          form.maxRedemptionAmount === "" ? null : Number(form.maxRedemptionAmount),
      });

      if (!data.success) {
        setMessage(data.message || "Could not issue gift cards.");
        return;
      }
      setIssued(data.giftCards || []);
    } catch {
      setMessage("Unable to connect. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (issued.length > 0) {
    const total = issued.reduce((sum, c) => sum + (Number(c.initial_amount) || 0), 0);
    return (
      <div className="filament-page">
        <Breadcrumb
          items={[
            { label: "Gift Cards", to: "/gift-cards" },
            { label: "Bulk issued" },
          ]}
        />

        <div className="filament-card">
          <div className="filament-card-header">
            <div className="filament-card-header-left">
              <h1>{issued.length} gift cards issued</h1>
              <span className="filament-muted">Total value {formatCurrency(total)}</span>
            </div>
            <div className="filament-card-header-right">
              <button
                type="button"
                className="filament-btn filament-btn-primary"
                onClick={() => downloadGiftCardsCsv(issued, `gift-cards-${Date.now()}.csv`)}
              >
                Download CSV
              </button>
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={() => navigate("/gift-cards")}
              >
                Done
              </button>
            </div>
          </div>

          <div className="filament-pad">
            <div className="filament-alert">
              Codes are stored hashed and cannot be shown again. Download the
              CSV now and keep it somewhere safe.
            </div>

            <div className="filament-table-wrap">
              <table className="filament-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Value</th>
                    <th>Recipient</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {issued.map((card) => (
                    <tr key={card.uuid || card.code}>
                      <td>
                        <code className="coupon-code">{card.code}</code>
                      </td>
                      <td>{formatCurrency(card.initial_amount)}</td>
                      <td>
                        {card.recipient_email || <span className="filament-muted">Anyone</span>}
                      </td>
                      <td>
                        {card.expires_at
                          ? new Date(card.expires_at).toLocaleDateString("en-IN", { dateStyle: "medium" })
                          : <span className="filament-muted">No limit</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="filament-page">
      <Breadcrumb
        items={[
          { label: "Gift Cards", to: "/gift-cards" },
          { label: "Bulk issue" },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <form className="admin-form admin-form-full" onSubmit={onSubmit}>
        <div className="filament-card">
          <div className="filament-card-header">
            <div className="filament-card-header-left">
              <h1>Issue Gift Cards In Bulk</h1>
            </div>
            <div className="filament-card-header-right">
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={() => navigate("/gift-cards")}
              >
                ← Back
              </button>
              <button type="submit" className="filament-btn filament-btn-primary" disabled={saving || !canSubmit}>
                {saving ? "Issuing…" : "Issue cards"}
              </button>
            </div>
          </div>

          <div className="detail-grid" style={{ gridTemplateColumns: "1fr" }}>
            <div className="detail-block">
              <h3>How many</h3>
              <div className="form-row">
                <label className="form-label">Count *</label>
                <input type="number" min="1" max="500" step="1" value={form.count} onChange={set("count")} />
                <p className="input-hint">Up to 500 cards per batch.</p>
                {errors.count && <p className="input-error" style={{ margin: "0.25rem 0 0" }}>{errors.count}</p>}
              </div>
              <div className="form-row" style={{ marginTop: 14 }}>
                <label className="form-label">Value per card (₹) *</label>
                <input type="number" min="1" step="0.01" value={form.amount} onChange={set("amount")} placeholder="500" />
                {errors.amount && <p className="input-error" style={{ margin: "0.25rem 0 0" }}>{errors.amount}</p>}
              </div>
            </div>

            <div className="detail-block">
              <h3>Shared configuration</h3>
              <div className="form-row">
                <label className="form-label">Recipient email</label>
                <input
                  type="email"
                  value={form.recipientEmail}
                  onChange={set("recipientEmail")}
                  placeholder="Optional — blank means whoever redeems first"
                />
              </div>
              <div className="form-row" style={{ marginTop: 14 }}>
                <label className="form-label">Expires at</label>
                <input type="datetime-local" value={form.expiresAt} onChange={set("expiresAt")} />
              </div>
              <div className="form-row" style={{ marginTop: 14 }}>
                <label className="form-label">Status</label>
                <select value={form.status} onChange={set("status")}>
                  <option value={GIFT_CARD_STATUS.ACTIVE}>Active</option>
                  <option value={GIFT_CARD_STATUS.DRAFT}>Draft — not yet usable</option>
                </select>
              </div>
              <div className="form-row" style={{ marginTop: 14 }}>
                <label className="form-label">Times redeemable</label>
                <input type="number" min="1" step="1" value={form.usageLimit} onChange={set("usageLimit")} placeholder="Blank = unlimited" />
              </div>
              <div className="form-row" style={{ marginTop: 14 }}>
                <label className="form-label">Maximum per order (₹)</label>
                <input type="number" min="0" step="0.01" value={form.maxRedemptionAmount} onChange={set("maxRedemptionAmount")} placeholder="Blank = no cap" />
              </div>
              <div className="form-row" style={{ marginTop: 14 }}>
                <label className="form-label">Minimum order (₹)</label>
                <input type="number" min="0" step="0.01" value={form.minOrderAmount} onChange={set("minOrderAmount")} placeholder="0" />
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
