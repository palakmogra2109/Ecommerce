import { useEffect, useMemo, useState } from "react";
import { createSupplier, updateSupplier } from "../services/purchases";
import CountryStateCity from "../components/CountryStateCity";

// Create/edit supplier, rendered as a modal by the list page and as the body of
// the supplier detail page.
//
// The server validates and normalises everything, so this mirrors only the rules
// worth catching before a round trip. Anything subtler is left to the server,
// whose message names the offending field.
//
// GSTIN and email are checked as you type and the field turns green when they
// parse, because those are the two fields people mistype most and both are
// checked strictly on the way in.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Letters and digits only. Not the rigid 15-character GSTIN layout: an
// overseas or SEZ supplier may have a VAT or EIN number instead, and a
// supplier whose tax ID will not save cannot be invoiced.
const TAX_ID = /^[A-Z0-9]*$/;

const PAYMENT_TERMS = [0, 7, 15, 30, 45, 60, 90];

const empty = () => ({
  name: "",
  contact_name: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  postal_code: "",
  country: "IN",
  gstin: "",
  payment_terms_days: "30",
  notes: "",
});

// closeOnSave: a modal must dismiss itself once saved, but the edit *page* must
// stay put -- it called onClose() straight after onSaved(), navigated to the view
// route, and the "Supplier updated" notice was set on a page nobody was looking
// at any more. So the save looked like it did nothing.
export default function SupplierForm({ supplier = null, onClose, onSaved, closeOnSave = true }) {
  const [form, setForm] = useState(() =>
    supplier
      ? Object.fromEntries(
          Object.keys(empty()).map((key) => [key, supplier[key] ?? empty()[key]])
        )
      : empty()
  );
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  };

  const gstin = form.gstin.trim().toUpperCase().replace(/\s+/g, "");
  const gstinValid = TAX_ID.test(gstin);
  const emailValid = !form.email.trim() || EMAIL.test(form.email.trim());

  const problems = useMemo(() => {
    const found = {};
    if (!form.name.trim()) found.name = "A supplier needs a name";
    if (!emailValid) found.email = "That does not look like an email address";
    if (!gstinValid) found.gstin = "Letters and numbers only";
    const terms = Number(form.payment_terms_days);
    if (form.payment_terms_days !== "" && (Number.isNaN(terms) || terms < 0 || terms > 365)) {
      found.payment_terms_days = "Between 0 and 365 days";
    }
    return found;
  }, [form.name, form.email, form.gstin, form.payment_terms_days, emailValid, gstinValid]);

  const submit = async (event) => {
    event?.preventDefault?.();
    if (busy || Object.keys(problems).length > 0) return;
    setBusy(true);
    setErrors({});
    try {
      const payload = {
        name: form.name.trim(),
        contact_name: form.contact_name.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        postal_code: form.postal_code.trim() || null,
        country: form.country.trim() || null,
        gstin: gstin || null,
        payment_terms_days: form.payment_terms_days === "" ? 0 : Number(form.payment_terms_days),
        notes: form.notes.trim() || null,
      };
      if (supplier) {
        await updateSupplier(supplier.uuid, payload);
      } else {
        await createSupplier(payload);
      }
      onSaved?.(supplier ? "Supplier updated" : `${payload.name} added`);
      if (closeOnSave) onClose?.();
    } catch (error) {
      setErrors({ form: error.message });
    } finally {
      setBusy(false);
    }
  };

  // `problems` comes from what is typed, `errors` only after the server refuses.
  // Both are shown: gating submit on `problems` without rendering it left a dead
  // button that explained nothing.
  const message = (key) => problems[key] || errors[key];

  const field = (key, label, extra = {}) => (
    <label className="frm-field">
      <span>{label}</span>
      <input
        type="text"
        value={form[key]}
        onChange={set(key)}
        className={message(key) ? "frm-bad" : undefined}
        {...extra}
      />
      {message(key) && <small className="frm-error">{message(key)}</small>}
    </label>
  );

  const body = (
    <div className="filament-modal-body sp-body">
      {errors.form && <div className="filament-alert filament-alert-info">{errors.form}</div>}

      <h4 className="frm-section">Who they are</h4>
      <div className="frm-grid">
        {field("name", "Supplier name *", {
          required: true,
          placeholder: "Acme Components Pvt Ltd",
          autoFocus: !supplier,
        })}
        {field("contact_name", "Contact person", { placeholder: "Who do you speak to" })}
      </div>

      <hr className="frm-rule" />
      <h4 className="frm-section">How to reach them</h4>
      <div className="frm-grid">
        <label className="frm-field">
          <span>Email</span>
          <input
            type="email"
            value={form.email}
            onChange={set("email")}
            placeholder="accounts@supplier.com"
            className={!emailValid ? "frm-bad" : form.email.trim() ? "frm-ok" : undefined}
          />
          {!emailValid && <small className="frm-error">That does not look like an email address</small>}
        </label>
        {field("phone", "Phone", { type: "tel", placeholder: "+91 …" })}
      </div>

      <hr className="frm-rule" />
      <h4 className="frm-section">Where they are</h4>
      <div className="frm-grid sp-grid-wide">
        {field("address", "Address", { placeholder: "Street, area" })}
        <div className="frm-field">
          <span>PIN / postcode</span>
          <input type="text" value={form.postal_code} onChange={set("postal_code")} inputMode="numeric" />
        </div>
      </div>
      <CountryStateCity
        country={form.country}
        state={form.state}
        city={form.city}
        onCountryChange={(value) => setForm((c) => ({ ...c, country: value }))}
        onStateChange={(value) => setForm((c) => ({ ...c, state: value }))}
        onCityChange={(value) => setForm((c) => ({ ...c, city: value }))}
      />

      <hr className="frm-rule" />
      <h4 className="frm-section">Tax and payment terms</h4>
      <div className="frm-grid">
        <label className="frm-field">
          <span>GSTIN / tax registration</span>
          <input
            type="text"
            value={form.gstin}
            onChange={(event) =>
              // Upper-cased as it is typed, so the value posted is already the
              // form the server stores it in.
              setForm((current) => ({ ...current, gstin: event.target.value.toUpperCase() }))
            }
            placeholder="GSTIN, VAT or EIN number"
            maxLength={32}
            className={!gstinValid ? "frm-bad" : gstin ? "frm-ok" : undefined}
          />
          {gstin && gstinValid && <small className="frm-hint frm-hint-ok">Looks valid</small>}
          {!gstinValid && <small className="frm-error">Letters and numbers only, no spaces or dashes</small>}
        </label>

        <label className="frm-field">
          <span>Payment terms</span>
          <select value={form.payment_terms_days} onChange={set("payment_terms_days")}>
            {PAYMENT_TERMS.map((days) => (
              <option key={days} value={days}>
                {days === 0 ? "Due immediately" : `Net ${days} days`}
              </option>
            ))}
          </select>
          <small className="frm-hint">Used to suggest a due date on invoices.</small>
        </label>
      </div>

      <hr className="frm-rule" />
      <div className="frm-grid">
        {field("notes", "Notes", { placeholder: "Anything worth remembering" })}
      </div>
    </div>
  );

  const footer = (
    <div className="filament-modal-footer">
      <button type="button" className="filament-btn filament-btn-outline" onClick={onClose}>
        {supplier ? "Cancel" : "Discard"}
      </button>
      <button
        type="submit"
        form="supplier-form"
        className="filament-btn filament-btn-primary"
        disabled={busy || Object.keys(problems).length > 0}
      >
        {busy ? "Saving…" : supplier ? "Save changes" : "Add supplier"}
      </button>
      {!busy && Object.keys(problems).length > 0 && (
        <small className="frm-hint frm-warn">
          Fix: {[...new Set(Object.values(problems))].join(" · ")}
        </small>
      )}
    </div>
  );

  if (supplier) {
    // On the detail page the form is the page, not a dialog.
    return (
      <form id="supplier-form" onSubmit={submit}>
        {body}
        {footer}
      </form>
    );
  }

  return (
    <div className="filament-modal-overlay" onClick={onClose}>
      <div
        className="filament-modal filament-modal-lg sp-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New supplier"
      >
        <div className="filament-modal-header">
          <div>
            <h2>New supplier</h2>
            <p className="filament-modal-sub">
              Someone you buy from. Needed before a purchase invoice can be booked.
            </p>
          </div>
          <button type="button" className="filament-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form id="supplier-form" onSubmit={submit}>
          {body}
          {footer}
        </form>
      </div>
    </div>
  );
}
