import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { storeProfile, storeUpdateProfile } from "../services/store";
import {
  FiCheck,
  FiClock,
  FiMapPin,
  FiSave,
  FiShoppingBag,
  FiTruck,
} from "react-icons/fi";

const STEPS = [
  { key: "details", label: "Store details", icon: FiShoppingBag },
  { key: "location", label: "Location", icon: FiMapPin },
  { key: "services", label: "Services & hours", icon: FiClock },
  { key: "review", label: "Launch", icon: FiCheck },
];

const FIELD_GROUPS = {
  details: ["name", "email", "phone", "description"],
  location: ["addressLine1", "addressLine2", "city", "state", "country", "postalCode"],
  services: ["openingTime", "closingTime", "deliveryEnabled", "pickupEnabled", "deliveryRadius"],
};

const EMPTY_FORM = {
  name: "",
  email: "",
  phone: "",
  description: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  country: "India",
  postalCode: "",
  openingTime: "09:00",
  closingTime: "21:00",
  timezone: "Asia/Kolkata",
  deliveryEnabled: true,
  pickupEnabled: true,
  deliveryRadius: "",
};

export default function StoreOnboarding({ mode = "wizard" }) {
  const navigate = useNavigate();
  const { user, refresh, logout } = useAuth();
  const [branchId, setBranchId] = useState("");
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);

  const branches = user?.branches || [];
  const totalSteps = mode === "wizard" ? STEPS.length : STEPS.length - 1;

  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }
    if (branches.length === 0) {
      navigate("/");
      return;
    }
    const activeId = branchId || branches[0].uuid || branches[0].id || "";
    setBranchId(activeId);
  }, [user]);

  async function loadProfile() {
    setLoading(true);
    setError("");
    try {
      const data = await storeProfile(branchId);
      if (data.success) {
        const b = data.branch || {};
        setForm({
          name: b.name || "",
          email: b.email || "",
          phone: b.phone || "",
          description: b.description || "",
          addressLine1: b.addressLine1 || "",
          addressLine2: b.addressLine2 || "",
          city: b.city || "",
          state: b.state || "",
          country: b.country || "India",
          postalCode: b.postalCode || "",
          openingTime: (b.openingTime || "09:00").slice(0, 5),
          closingTime: (b.closingTime || "21:00").slice(0, 5),
          timezone: b.timezone || "Asia/Kolkata",
          deliveryEnabled: b.deliveryEnabled !== false,
          pickupEnabled: b.pickupEnabled !== false,
          deliveryRadius: b.deliveryRadius != null ? String(b.deliveryRadius) : "",
        });
        setOnboardingCompleted(Boolean(b.onboardingCompleted));
      } else {
        setError(data.message || "Could not load store profile");
      }
    } catch {
      setError("Something went wrong while loading the store.");
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!branchId) return;
    loadProfile();
  }, [branchId]);

  useEffect(() => {
    if (mode === "edit") return;
    if (onboardingCompleted) {
      navigate("/manager", { replace: true });
    }
  }, [onboardingCompleted, mode]);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError("");
  }

  function setField(field) {
    return (e) => {
      const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      update(field, value);
    };
  }

  async function save(extra = {}) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const data = await storeUpdateProfile(branchId, { ...form, ...extra });
      if (data.success) {
        setNotice(data.message || "Saved");
        return true;
      }
      setError(data.message || "Could not save changes");
      return false;
    } catch {
      setError("Failed to save. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function continueStep() {
    const group = FIELD_GROUPS[STEPS[step - 1].key];
    if (group.includes("name") && !form.name.trim()) {
      setError("Store name is required");
      return;
    }
    const ok = await save();
    if (ok) setStep((s) => s + 1);
  }

  async function goLive() {
    const ok = await save({ onboardingCompleted: true });
    if (!ok) return;
    setOnboardingCompleted(true);
    await refresh();
  }

  async function saveAll() {
    const ok = await save();
    if (ok) {
      await refresh();
    }
  }

  function fieldValue(field) {
    return form[field] ?? "";
  }

  function SectionTitle({ icon: Icon, title }) {
    return (
      <h3 className="store-field-title">
        <Icon />
        {title}
      </h3>
    );
  }

  function renderDetails() {
    return (
      <>
        <SectionTitle icon={FiStore} title="Store identity" />
        <div className="store-field-grid">
          <label className="store-field">
            <span>Store name *</span>
            <input type="text" value={fieldValue("name")} onChange={setField("name")} placeholder="Earth धान्य Downtown" />
          </label>
          <label className="store-field">
            <span>Contact email</span>
            <input type="email" value={fieldValue("email")} onChange={setField("email")} placeholder="store@example.com" />
          </label>
          <label className="store-field">
            <span>Phone</span>
            <input type="tel" value={fieldValue("phone")} onChange={setField("phone")} placeholder="+91-XXXXXXXXXX" />
          </label>
          <label className="store-field">
            <span>Description</span>
            <textarea value={fieldValue("description")} onChange={setField("description")} placeholder="Tell customers what makes your store special" rows={3} />
          </label>
        </div>
      </>
    );
  }

  function renderLocation() {
    return (
      <>
        <SectionTitle icon={FiMapPin} title="Store location" />
        <div className="store-field-grid">
          <label className="store-field span-2">
            <span>Address line 1</span>
            <input type="text" value={fieldValue("addressLine1")} onChange={setField("addressLine1")} placeholder="Shop 12, Ground floor" />
          </label>
          <label className="store-field span-2">
            <span>Address line 2</span>
            <input type="text" value={fieldValue("addressLine2")} onChange={setField("addressLine2")} placeholder="Area, landmark" />
          </label>
          <label className="store-field">
            <span>City</span>
            <input type="text" value={fieldValue("city")} onChange={setField("city")} placeholder="Pune" />
          </label>
          <label className="store-field">
            <span>State</span>
            <input type="text" value={fieldValue("state")} onChange={setField("state")} placeholder="Maharashtra" />
          </label>
          <label className="store-field">
            <span>Country</span>
            <input type="text" value={fieldValue("country")} onChange={setField("country")} />
          </label>
          <label className="store-field">
            <span>Postal code</span>
            <input type="text" value={fieldValue("postalCode")} onChange={setField("postalCode")} placeholder="411001" />
          </label>
        </div>
      </>
    );
  }

  function renderServices() {
    return (
      <>
        <SectionTitle icon={FiClock} title="Opening hours" />
        <div className="store-field-grid">
          <label className="store-field">
            <span>Opens at</span>
            <input type="time" value={fieldValue("openingTime")} onChange={setField("openingTime")} />
          </label>
          <label className="store-field">
            <span>Closes at</span>
            <input type="time" value={fieldValue("closingTime")} onChange={setField("closingTime")} />
          </label>
          <label className="store-field">
            <span>Timezone</span>
            <select value={fieldValue("timezone")} onChange={setField("timezone")}>
              <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
              <option value="Asia/Karachi">Asia/Karachi</option>
              <option value="Asia/Dubai">Asia/Dubai</option>
              <option value="Europe/London">Europe/London</option>
              <option value="America/New_York">America/New_York</option>
              <option value="America/Los_Angeles">America/Los_Angeles</option>
              <option value="UTC">UTC</option>
            </select>
          </label>
          <label className="store-field">
            <span>Delivery radius (km)</span>
            <input type="number" min="0" value={fieldValue("deliveryRadius")} onChange={setField("deliveryRadius")} placeholder="5" />
          </label>
        </div>

        <h3 className="store-field-title">
          <FiTruck />
          Services
        </h3>
        <div className="store-toggle-row">
          <label className="store-toggle">
            <input type="checkbox" checked={form.deliveryEnabled} onChange={setField("deliveryEnabled")} />
            <span className="store-toggle-track"><span className="store-toggle-knob" /></span>
            <span className="store-toggle-label">Delivery</span>
          </label>
          <label className="store-toggle">
            <input type="checkbox" checked={form.pickupEnabled} onChange={setField("pickupEnabled")} />
            <span className="store-toggle-track"><span className="store-toggle-knob" /></span>
            <span className="store-toggle-label">Pickup</span>
          </label>
        </div>
      </>
    );
  }

  function renderReview() {
    const rows = [
      ["Store name", form.name],
      ["Contact", [form.email, form.phone].filter(Boolean).join(" · ")],
      ["Address", [form.addressLine1, form.addressLine2, form.city, form.state, form.postalCode].filter(Boolean).join(", ")],
      ["Opening hours", `${form.openingTime} – ${form.closingTime}`],
      ["Services", [form.deliveryEnabled ? "Delivery" : null, form.pickupEnabled ? "Pickup" : null].filter(Boolean).join(", ") || "None"],
      ["Delivery radius", form.deliveryRadius ? `${form.deliveryRadius} km` : "Not set"],
    ].filter((r) => r[1]);
    return (
      <>
        <SectionTitle icon={FiCheck} title="Review & launch" />
        <div className="store-review-list">
          {rows.map(([label, value]) => (
            <div key={label} className="store-review-row">
              <span className="store-review-label">{label}</span>
              <span className="store-review-value">{value}</span>
            </div>
          ))}
        </div>
        <p className="store-review-note">
          Your store will be visible to customers once launched. You can change any of these details later from Settings.
        </p>
      </>
    );
  }

  function renderStepBody(stepKey) {
    if (stepKey === "details") return renderDetails();
    if (stepKey === "location") return renderLocation();
    if (stepKey === "services") return renderServices();
    return renderReview();
  }

  const currentStep = STEPS[step - 1];

  const card = (
    <div className="store-onboarding-card">
      {error && <p className="store-form-message error">{error}</p>}
      {notice && <p className="store-form-message ok">{notice}</p>}

      {mode === "edit" ? (
        <>
          {renderDetails()}
          {renderLocation()}
          {renderServices()}
          <div className="store-actions">
            <button className="sf-btn primary" onClick={saveAll} disabled={saving}>
              <FiSave /> {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (step === totalSteps) goLive();
            else continueStep();
          }}
        >
          {renderStepBody(currentStep.key)}
          <div className="store-actions">
            {step > 1 && (
              <button type="button" className="sf-btn ghost" onClick={() => setStep((s) => s - 1)}>
                Back
              </button>
            )}
            <button type="submit" className="sf-btn primary" disabled={saving}>
              {saving ? "Saving..." : step === totalSteps ? "Go live" : "Continue"}
            </button>
          </div>
        </form>
      )}
    </div>
  );

  if (mode === "edit") {
    return loading ? <p className="store-loading">Loading store...</p> : (
      <div className="store-onboarding">
        <h2 className="store-section-heading">Store Settings</h2>
        {branches.length > 1 && (
          <select className="store-branch-select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.uuid} value={b.uuid}>{b.name}</option>
            ))}
          </select>
        )}
        {card}
      </div>
    );
  }

  return (
    <div className="store-panel">
      <div className="store-header">
        <div className="store-header-left">
          <h1>Store Onboarding</h1>
          {branches.length > 1 && (
            <select className="store-branch-select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => (
                <option key={b.uuid} value={b.uuid}>{b.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="store-header-actions">
          {!onboardingCompleted && (
            <button className="sf-btn ghost" onClick={async () => { await save(); refresh(); navigate("/manager"); }}>
              Save & finish later
            </button>
          )}
          <button className="sf-btn ghost" onClick={() => { logout(); navigate("/"); }}>Logout</button>
        </div>
      </div>

      {loading ? (
        <p className="store-loading">Loading store...</p>
      ) : (
        <div className="store-onboarding">
          <div className="onboarding-progress">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const done = step > i + 1;
              const active = step === i + 1;
              return (
                <div key={s.key} className={`onboarding-step${active ? " active" : ""}${done ? " done" : ""}`}>
                  <span className="onboarding-step-dot">
                    {done ? "✓" : <Icon />}
                  </span>
                  <span className="onboarding-step-label">{s.label}</span>
                </div>
              );
            })}
          </div>
          {card}
        </div>
      )}
    </div>
  );
}