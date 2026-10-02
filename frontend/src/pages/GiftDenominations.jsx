import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listDenominations,
  createDenomination,
  updateDenomination,
  deleteDenomination,
} from "../services/giftCards";
import Breadcrumb from "../components/Breadcrumb";
import { formatCurrency } from "@shared/constants";
import { useAuth } from "../context/AuthContext";
import { giftCardImage } from "../lib/giftCardArt";

const EMPTY = {
  label: "Gift Card",
  faceValue: "",
  sellingPrice: "",
  validForDays: "365",
  sortOrder: "0",
  isActive: true,
};

// Manages the E-Cards shelf. A selling price below the face value is a
// promotion and shows as a discount on the shop page.
export default function GiftDenominations() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canCreate = can("gift_cards.create");
  const canUpdate = can("gift_cards.update");

  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  // Deleting is destructive, so it asks first; the common case is hiding.
  const [confirmDelete, setConfirmDelete] = useState(null);
  const editingRow = rows?.find((r) => r.uuid === editing) || null;

  async function load() {
    const data = await listDenominations();
    setRows(data.success ? data.denominations : []);
  }

  useEffect(() => {
    load();
  }, []);

  const set = (key) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: "" }));
  };

  function startEdit(d) {
    setEditing(d.uuid);
    setForm({
      label: d.label,
      faceValue: String(d.face_value),
      sellingPrice: d.discounted ? String(d.selling_price) : "",
      validForDays: d.valid_for_days == null ? "" : String(d.valid_for_days),
      sortOrder: String(d.sort_order ?? 0),
      isActive: d.is_active,
    });
    setMessage("");
  }

  function reset() {
    setEditing(null);
    setForm(EMPTY);
    setErrors({});
    setMessage("");
  }

  // Live maths for the form, so a promotion is visible before it is saved.
  const draftFace = Number(form.faceValue) || 0;
  const draftPrice = form.sellingPrice === "" ? draftFace : Number(form.sellingPrice) || draftFace;
  const draftDiscount =
    draftFace > 0 && draftPrice > 0 && draftPrice < draftFace
      ? { price: draftPrice, percent: Math.round(((draftFace - draftPrice) / draftFace) * 100) }
      : null;

  function onSubmitForm(e) {
    e.preventDefault();
    save();
  }

  function validate() {
    const next = {};
    const face = Number(form.faceValue);
    if (!(face > 0)) next.faceValue = "Face value must be greater than zero.";
    if (form.sellingPrice !== "" && Number(form.sellingPrice) >= face) {
      next.sellingPrice = "Must be lower than the face value to be a discount.";
    }
    if (form.validForDays !== "" && !(Number(form.validForDays) > 0)) {
      next.validForDays = "Use a positive number of days, or leave blank.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    setMessage("");
    const payload = {
      label: form.label.trim() || "Gift Card",
      faceValue: Number(form.faceValue),
      sellingPrice: form.sellingPrice === "" ? null : Number(form.sellingPrice),
      validForDays: form.validForDays === "" ? null : Number(form.validForDays),
      sortOrder: Number(form.sortOrder) || 0,
      isActive: form.isActive,
    };
    const data = editing
      ? await updateDenomination(editing, payload)
      : await createDenomination(payload);
    setSaving(false);
    if (!data.success) {
      setMessage(data.message || "Could not save.");
      return;
    }
    reset();
    await load();
  }

  return (
    <div className="filament-page">
      <Breadcrumb
        items={[
          { label: "Gift Cards", to: "/gift-cards" },
          { label: "Denominations" },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>E-Card Denominations</h1>
            <span className="filament-muted">
              What shoppers can buy. A lower selling price is shown as a discount.
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
          </div>
        </div>

        <div className="filament-pad">
          {rows !== null && rows.length > 0 && (
            <div className="gc-shelf-preview">
              <span className="form-label">How this looks in the shop</span>
              <div className="gc-shelf-strip">
                {rows
                  .filter((d) => d.is_active)
                  .map((d) => (
                    <div className="gc-shelf-item" key={d.uuid}>
                      {d.discounted && (
                        <span className="sf-ecard-flag save">{d.discount_percent}% OFF</span>
                      )}
                      <span className="sf-ecard-flag">INSTANT</span>
                      <img
                        className="sf-ecard-art"
                        src={giftCardImage({ label: d.label, amount: d.face_value })}
                        alt=""
                      />
                      <div className="sf-ecard-face">{formatCurrency(d.face_value)}</div>
                      {d.discounted && (
                        <div className="sf-ecard-mrp">{formatCurrency(d.face_value)}</div>
                      )}
                      <div
                        className="sf-btn primary"
                        style={{ width: "100%", justifyContent: "center", marginTop: 10 }}
                      >
                        Buy {formatCurrency(d.selling_price)}
                      </div>
                    </div>
                  ))}
                {rows.every((d) => !d.is_active) && (
                  <p className="filament-muted">
                    All denominations are hidden, so the shop shows nothing.
                  </p>
                )}
              </div>
            </div>
          )}

          {rows === null ? (
            <div className="filament-empty"><div className="filament-spinner" /></div>
          ) : rows.length === 0 ? (
            <div className="filament-empty">
              <p>No denominations yet. Add one to open the E-Cards shelf.</p>
            </div>
          ) : (
            <div className="filament-table-wrap">
              <table className="filament-table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Face value</th>
                    <th>Selling price</th>
                    <th>Validity</th>
                    <th>Order</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.uuid}>
                      <td>{d.label}</td>
                      <td>{formatCurrency(d.face_value)}</td>
                      <td>
                        {formatCurrency(d.selling_price)}
                        {d.discounted && (
                          <span className="filament-badge" style={{ marginLeft: 8 }}>
                            {d.discount_percent}% off
                          </span>
                        )}
                      </td>
                      <td>{d.valid_for_days ? `${d.valid_for_days} days` : "No expiry"}</td>
                      <td>{d.sort_order}</td>
                      <td>
                        <span className={`filament-badge filament-badge-${d.is_active ? "active" : "inactive"}`}>
                          <span className="filament-badge-dot" />
                          {d.is_active ? "Live" : "Hidden"}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {canUpdate && (
                            <>
                              <button
                                type="button"
                                className="filament-btn filament-btn-secondary"
                                onClick={() => (editing === d.uuid ? reset() : startEdit(d))}
                              >
                                {editing === d.uuid ? "Cancel" : "Edit"}
                              </button>
                              {/* Hiding is reversible and keeps already-sold
                                  cards linked to this denomination. */}
                              <button
                                type="button"
                                className="filament-btn filament-btn-outline"
                                onClick={async () => {
                                  const data = await updateDenomination(d.uuid, {
                                    isActive: !d.is_active,
                                  });
                                  setMessage(
                                    data.success
                                      ? `${formatCurrency(d.face_value)} is now ${d.is_active ? "hidden from" : "visible in"} the shop.`
                                      : data.message
                                  );
                                  await load();
                                }}
                              >
                                {d.is_active ? "Hide" : "Show"}
                              </button>
                            </>
                          )}
                          {can("gift_cards.delete") && (
                            <button
                              type="button"
                              className="filament-btn filament-btn-outline"
                              onClick={() => setConfirmDelete(d)}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {canCreate && (
        <div className="filament-card" style={{ marginTop: 16 }}>
          <div className="filament-card-header">
            <div className="filament-card-header-left">
              <h1>{editing ? "Edit denomination" : "Add denomination"}</h1>
              <span className="filament-muted">
                {editing
                  ? `Editing ${formatCurrency(editingRow?.face_value || 0)}`
                  : "A card a shopper can buy."}
              </span>
            </div>
            {editing && (
              <div className="filament-card-header-right">
                <button
                  type="button"
                  className="filament-btn filament-btn-outline"
                  onClick={reset}
                >
                  Cancel edit
                </button>
              </div>
            )}
          </div>

          {/* admin-form is what styles the inputs -- there is no global input
              rule, so without it these render as raw browser defaults. It is
              also a real <form>, so Enter submits. */}
          <form className="admin-form resource-form" onSubmit={onSubmitForm}>
            {/* Two columns, matching the rest of the admin, instead of one
                very tall stack of full-width fields. */}
            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">Label</label>
                <input
                  value={form.label}
                  onChange={set("label")}
                  placeholder="Gift Card"
                />
                <p className="input-hint">Shown on the card and in the email.</p>
              </div>

              <div className="form-row">
                <label className="form-label">Face value (₹) *</label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={form.faceValue}
                  onChange={set("faceValue")}
                  placeholder="500"
                />
                <p className="input-hint">What the recipient's card is worth.</p>
                {errors.faceValue && <p className="input-error">{errors.faceValue}</p>}
              </div>

              <div className="form-row">
                <label className="form-label">Selling price (₹)</label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={form.sellingPrice}
                  onChange={set("sellingPrice")}
                  placeholder="Blank = no discount"
                />
                {/* Live, so the saving is visible before saving. */}
                {draftDiscount ? (
                  <p className="gc-discount-live">
                    {draftDiscount.percent}% off — shopper pays{" "}
                    {formatCurrency(draftDiscount.price)}
                  </p>
                ) : (
                  <p className="input-hint">Lower than the face value to run a promotion.</p>
                )}
                {errors.sellingPrice && <p className="input-error">{errors.sellingPrice}</p>}
              </div>

              <div className="form-row">
                <label className="form-label">Validity (days)</label>
                <input
                  type="number"
                  min="1"
                  value={form.validForDays}
                  onChange={set("validForDays")}
                  placeholder="Blank = never expires"
                />
                <p className="input-hint">Sets the card's expiry when it is bought.</p>
                {errors.validForDays && <p className="input-error">{errors.validForDays}</p>}
              </div>

              <div className="form-row">
                <label className="form-label">Sort order</label>
                <input type="number" value={form.sortOrder} onChange={set("sortOrder")} />
                <p className="input-hint">Lower numbers appear first in the shop.</p>
              </div>

              <div className="form-row">
                <label className="form-label">Visibility</label>
                <label className="filament-check" style={{ marginTop: 6 }}>
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={set("isActive")}
                  />
                  Visible in the shop
                </label>
                <p className="input-hint">
                  Hidden denominations stay attached to cards already sold.
                </p>
              </div>
            </div>

            {/* Preview of the card currently being typed, before it exists. */}
            {draftFace > 0 && (
              <div className="gc-draft-preview">
                <span className="form-label">Preview</span>
                <div className="gc-shelf-item" style={{ maxWidth: 200 }}>
                  {draftDiscount && (
                    <span className="sf-ecard-flag save">{draftDiscount.percent}% OFF</span>
                  )}
                  <span className="sf-ecard-flag">INSTANT</span>
                  <img
                    className="sf-ecard-art"
                    src={giftCardImage({
                      label: form.label.trim() || "Gift Card",
                      amount: draftFace,
                    })}
                    alt=""
                  />
                  <div className="sf-ecard-face">{formatCurrency(draftFace)}</div>
                  {draftDiscount && (
                    <div className="sf-ecard-mrp">{formatCurrency(draftFace)}</div>
                  )}
                  <div
                    className="sf-btn primary"
                    style={{ width: "100%", justifyContent: "center", marginTop: 10 }}
                  >
                    Buy {formatCurrency(draftPrice)}
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button
                type="submit"
                className="filament-btn filament-btn-primary"
                disabled={saving}
              >
                {saving ? "Saving…" : editing ? "Save changes" : "Add denomination"}
              </button>
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={reset}
                disabled={saving}
              >
                {editing ? "Reset" : "Clear"}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmDelete && can("gift_cards.delete") && (
        <div className="filament-card" style={{ marginTop: 16, borderColor: "var(--accent-border)" }}>
          <div className="filament-card-header">
            <div className="filament-card-header-left">
              <h1>Delete {formatCurrency(confirmDelete.face_value)}?</h1>
              <span className="filament-muted">This cannot be undone.</span>
            </div>
          </div>
          <div className="filament-pad">
            <div className="filament-alert" style={{ marginBottom: 14 }}>
              Prefer <strong>Hide</strong>. Hiding takes the option off the shelf
              but keeps it attached to cards that were already sold, so their
              history still shows where they came from. Deleting breaks that link
              and the denomination cannot be restored.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={async () => {
                  const d = confirmDelete;
                  const data = await updateDenomination(d.uuid, { isActive: false });
                  setConfirmDelete(null);
                  setMessage(
                    data.success
                      ? `Hidden ${formatCurrency(d.face_value)} instead of deleting it.`
                      : data.message
                  );
                  await load();
                }}
              >
                Hide instead
              </button>
              <button
                type="button"
                className="filament-btn filament-btn-primary"
                onClick={async () => {
                  const d = confirmDelete;
                  const data = await deleteDenomination(d.uuid);
                  setConfirmDelete(null);
                  setMessage(
                    data.success ? `Deleted ${formatCurrency(d.face_value)}.` : data.message
                  );
                  await load();
                }}
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
