import { useEffect, useRef, useState } from "react";
import PhoneInput from "../PhoneInput";
import { validateMobile } from "../../utils/validation";
import { geocodeReverse, geocodeSearch } from "../../services/storefront";

const LABELS = ["Home", "Work", "Other"];
const EMPTY = {
  label: "Home",
  recipient: "",
  phone: "",
  line1: "",
  line2: "",
  landmark: "",
  city: "",
  state: "",
  country: "India",
  postalCode: "",
  latitude: null,
  longitude: null,
  isDefault: false,
};

export default function AddressForm({ initial, saving, serverErrors, notify, onCancel, onSubmit }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [errors, setErrors] = useState({});
  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsBusy, setSuggestionsBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const searchAbort = useRef(null);

  useEffect(() => {
    setForm({ ...EMPTY, ...(initial || {}) });
    setErrors({});
  }, [initial?.id]);

  useEffect(() => {
    if (searchText.trim().length < 3) {
      setSuggestions([]);
      setSuggestionsBusy(false);
      return;
    }
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    setSuggestionsBusy(true);
    const timer = setTimeout(async () => {
      let response;
      try {
        response = await geocodeSearch(searchText.trim());
      } catch {
        response = { ok: false, data: { message: "Location search is temporarily unavailable." } };
      }
      if (controller.signal.aborted) return;
      setSuggestionsBusy(false);
      if (!response.ok || !response.data.success) {
        notify(response.data.message || "Location search is temporarily unavailable.");
        setSuggestions([]);
        return;
      }
      setSuggestions(Array.isArray(response.data.results) ? response.data.results : []);
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [notify, searchText]);

  const set = (key) => (event) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  };

  function chooseSuggestion(suggestion) {
    setForm((current) => ({
      ...current,
      line1: suggestion.line1 || current.line1,
      line2: suggestion.line2 || current.line2,
      city: suggestion.city || current.city,
      state: suggestion.state || current.state,
      postalCode: suggestion.postalCode || current.postalCode,
      latitude: Number.isFinite(Number(suggestion.latitude)) ? Number(suggestion.latitude) : current.latitude,
      longitude: Number.isFinite(Number(suggestion.longitude)) ? Number(suggestion.longitude) : current.longitude,
    }));
  }

  function useCurrentLocation() {
    if (!("geolocation" in navigator)) {
      notify("Location is unavailable in this browser. Add your address manually.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        let response;
        try {
          response = await geocodeReverse({ lat: position.coords.latitude, lng: position.coords.longitude });
        } catch {
          response = { ok: false, data: { message: "Location search is temporarily unavailable." } };
        }
        setLocating(false);
        if (!response.ok || !response.data.success || !response.data.result) {
          notify(response.data.message || "Location search is temporarily unavailable.");
          return;
        }
        const result = response.data.result;
        setForm((current) => ({
          ...current,
          line1: result.line1 || current.line1,
          line2: result.line2 || current.line2,
          city: result.city || current.city,
          state: result.state || current.state,
          postalCode: result.postalCode || current.postalCode,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          source: "geolocation",
        }));
      },
      () => {
        setLocating(false);
        notify("Location permission denied — add your address manually.");
      },
      { timeout: 10000 }
    );
  }

  function submit(event) {
    event.preventDefault();
    const nextErrors = { ...(serverErrors || {}) };
    if (!form.recipient.trim()) nextErrors.recipient = "Enter the recipient name.";
    if (!form.line1.trim()) nextErrors.line1 = "Enter house, street, or area.";
    if (!form.city.trim()) nextErrors.city = "Enter city.";
    if (!form.state.trim()) nextErrors.state = "Enter state.";
    if (!/^\d{6}$/.test(form.postalCode.trim())) nextErrors.postalCode = "Enter a 6-digit pincode.";
    const phoneError = validateMobile(form.phone.trim());
    if (phoneError) nextErrors.phone = phoneError;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onSubmit({
      ...form,
      label: form.label.trim() || "Home",
      recipient: form.recipient.trim(),
      phone: form.phone.trim(),
      line1: form.line1.trim(),
      line2: form.line2.trim(),
      landmark: form.landmark.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      country: form.country.trim() || "India",
      postalCode: form.postalCode.trim(),
      latitude: form.latitude == null || form.latitude === "" ? null : Number(form.latitude),
      longitude: form.longitude == null || form.longitude === "" ? null : Number(form.longitude),
    });
  }

  return (
    <form className="sf-address-form" onSubmit={submit} noValidate>
      <div className="sf-field">
        <label>Search location</label>
        <input className="sf-input" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search area, landmark, or pincode" />
        {suggestionsBusy && <p className="muted small">Searching locations…</p>}
        {suggestions.length > 0 && (
          <div className="sf-address-suggestions">
            {suggestions.map((suggestion, index) => (
              <button type="button" key={`${suggestion.label}-${index}`} onClick={() => chooseSuggestion(suggestion)}>
                <strong>{suggestion.city || suggestion.label}</strong>
                <span>{suggestion.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button type="button" className="sf-btn sf-address-current" onClick={useCurrentLocation} disabled={locating}>
        {locating ? "Detecting current location…" : "Use my current location"}
      </button>

      <div className="sf-row-2">
        <div className="sf-field">
          <label>Label *</label>
          <select className="sf-input" value={form.label} onChange={set("label")}>
            {(LABELS.includes(form.label) ? LABELS : [...LABELS, form.label]).map((label) => <option key={label} value={label}>{label}</option>)}
          </select>
        </div>
        <div className="sf-field">
          <label>Recipient *</label>
          <input className="sf-input" value={form.recipient} onChange={set("recipient")} placeholder="Full name" />
          {errors.recipient && <p className="sf-field-error">{errors.recipient}</p>}
        </div>
      </div>

      <div className="sf-row-2">
        <div className="sf-field">
          <label>Mobile *</label>
          <PhoneInput
            name="phone"
            value={form.phone}
            onChange={(v) => { setForm((current) => ({ ...current, phone: v })); setErrors((current) => ({ ...current, phone: "" })); }}
            placeholder="98765 43210"
            defaultDialCode="+91"
            error={errors.phone}
          />
        </div>
        <div className="sf-field">
          <label>Pincode *</label>
          <input className="sf-input" value={form.postalCode} onChange={set("postalCode")} inputMode="numeric" placeholder="6-digit pincode" />
          {errors.postalCode && <p className="sf-field-error">{errors.postalCode}</p>}
        </div>
      </div>

      <div className="sf-field">
        <label>House / street *</label>
        <textarea className="sf-input" rows={2} value={form.line1} onChange={set("line1")} placeholder="House, street, building" />
        {errors.line1 && <p className="sf-field-error">{errors.line1}</p>}
      </div>

      <div className="sf-row-2">
        <div className="sf-field">
          <label>Area / locality</label>
          <input className="sf-input" value={form.line2} onChange={set("line2")} />
        </div>
        <div className="sf-field">
          <label>Landmark</label>
          <input className="sf-input" value={form.landmark} onChange={set("landmark")} />
        </div>
      </div>

      <div className="sf-row-2">
        <div className="sf-field">
          <label>City *</label>
          <input className="sf-input" value={form.city} onChange={set("city")} />
          {errors.city && <p className="sf-field-error">{errors.city}</p>}
        </div>
        <div className="sf-field">
          <label>State *</label>
          <input className="sf-input" value={form.state} onChange={set("state")} />
          {errors.state && <p className="sf-field-error">{errors.state}</p>}
        </div>
      </div>

      <label className="sf-check">
        <input type="checkbox" checked={form.isDefault} onChange={(event) => setForm((current) => ({ ...current, isDefault: event.target.checked }))} />
        Save as default address
      </label>

      <div className="sf-address-actions">
        <button type="button" className="sf-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="sf-btn primary" disabled={saving}>{saving ? "Saving…" : "Save address"}</button>
      </div>
    </form>
  );
}
