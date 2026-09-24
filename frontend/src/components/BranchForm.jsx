import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getBranch,
  createBranch,
  updateBranch,
} from "../services/branches";
import Breadcrumb from "./Breadcrumb";
import { STATUS } from "@shared/constants";
import { useAuth } from "../context/AuthContext";

const INVENTORY_MODES = Object.freeze({
  SINGLE: "SINGLE",
  PER_SKU: "PER_SKU",
  BY_ATTRIBUTE: "BY_ATTRIBUTE",
});

export default function BranchForm({ branchId = null }) {
  const isEdit = Boolean(branchId);
  const { id } = useParams();
  const { can } = useAuth();
  const canSubmit = can(isEdit ? "branches.update" : "branches.create");
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    code: "",
    phone: "",
    email: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    country: "India",
    postalCode: "",
    latitude: "",
    longitude: "",
    openingTime: "",
    closingTime: "",
    timezone: "Asia/Kolkata",
    status: STATUS.ACTIVE,
    deliveryEnabled: true,
    pickupEnabled: true,
    deliveryRadius: "",
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
      try {
        const data = await getBranch(id);
        if (active && data.success && data.branch) {
          const b = data.branch;
          setForm({
            name: b.name || "",
            code: b.code || "",
            phone: b.phone || "",
            email: b.email || "",
            addressLine1: b.addressLine1 || b.address || "",
            addressLine2: b.addressLine2 || "",
            city: b.city || "",
            state: b.state || "",
            country: b.country || "India",
            postalCode: b.postalCode || "",
            latitude: b.latitude != null ? String(b.latitude) : "",
            longitude: b.longitude != null ? String(b.longitude) : "",
            openingTime: b.openingTime || "",
            closingTime: b.closingTime || "",
            timezone: b.timezone || "Asia/Kolkata",
            status: b.status || STATUS.ACTIVE,
            deliveryEnabled: b.deliveryEnabled ?? true,
            pickupEnabled: b.pickupEnabled ?? true,
            deliveryRadius: b.deliveryRadius != null ? String(b.deliveryRadius) : "",
          });
        } else {
          setMessage(data.message || "Branch not found");
        }
      } catch {
        setMessage("Unable to load branch.");
      } finally {
        if (active) setLoading(false);
      }
    };

    run();
    return () => { active = false; };
  }, [isEdit, id]);

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = "Branch name is required.";
    if (!form.code.trim()) e.code = "Branch code is required.";
    else if (!/^[A-Z0-9-]{2,10}$/i.test(form.code)) e.code = "Code must be 2-10 alphanumeric characters or hyphens.";
    if (!form.city.trim()) e.city = "City is required.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setMessage("");

    try {
      const payload = { ...form, deliveryRadius: form.deliveryRadius === "" ? null : Number(form.deliveryRadius) };
      const data = isEdit
        ? await updateBranch(id, payload)
        : await createBranch(payload);

      if (data.success) {
        navigate("/branches");
      } else {
        setMessage(data.message || "Failed to save branch.");
      }
    } catch {
      setMessage("Unable to connect to the server.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="filament-empty"><div className="filament-spinner" /></div>;
  }

  return (
    <div className="filament-page">
      <Breadcrumb items={[
        { label: "Branches", to: "/branches" },
        { label: isEdit ? form.name : "New Branch" },
      ]} />

      <h1 className="filament-title">{isEdit ? "Edit Branch" : "New Branch"}</h1>

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-row">
              <label className="form-label">Branch Name <span className="required">*</span></label>
              <input type="text" name="name" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} required className={errors.name ? "input-error" : ""} />
              {errors.name && <p className="input-error">{errors.name}</p>}
            </div>

            <div className="form-row">
              <label className="form-label">Branch Code <span className="required">*</span></label>
              <input type="text" name="code" value={form.code} onChange={(e) => setForm({...form, code: e.target.value.toUpperCase()})} required placeholder="BR001" className={errors.code ? "input-error" : ""} />
              {errors.code && <p className="input-error">{errors.code}</p>}
              <p className="input-hint">Unique code like BR001, BR002.</p>
            </div>

            <div className="form-row">
              <label className="form-label">City <span className="required">*</span></label>
              <input type="text" name="city" value={form.city} onChange={(e) => setForm({...form, city: e.target.value})} required className={errors.city ? "input-error" : ""} />
              {errors.city && <p className="input-error">{errors.city}</p>}
            </div>

            <div className="form-row">
              <label className="form-label">State</label>
              <input type="text" name="state" value={form.state} onChange={(e) => setForm({...form, state: e.target.value})} />
            </div>

            <div className="form-row">
              <label className="form-label">Country</label>
              <input type="text" name="country" value={form.country} onChange={(e) => setForm({...form, country: e.target.value})} />
            </div>

            <div className="form-row">
              <label className="form-label">Postal Code</label>
              <input type="text" name="postalCode" value={form.postalCode} onChange={(e) => setForm({...form, postalCode: e.target.value})} />
            </div>

            <div className="form-row">
              <label className="form-label">Address Line 1</label>
              <input type="text" name="addressLine1" value={form.addressLine1} onChange={(e) => setForm({...form, addressLine1: e.target.value})} />
            </div>

            <div className="form-row">
              <label className="form-label">Address Line 2</label>
              <input type="text" name="addressLine2" value={form.addressLine2} onChange={(e) => setForm({...form, addressLine2: e.target.value})} />
            </div>

            <div className="form-row">
              <label className="form-label">Phone</label>
              <input type="text" name="phone" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} />
            </div>

            <div className="form-row">
              <label className="form-label">Email</label>
              <input type="email" name="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} />
            </div>

            <div className="form-row">
              <label className="form-label">Latitude</label>
              <input type="number" step="0.0000001" name="latitude" value={form.latitude} onChange={(e) => setForm({...form, latitude: e.target.value})} />
            </div>

            <div className="form-row">
              <label className="form-label">Longitude</label>
              <input type="number" step="0.0000001" name="longitude" value={form.longitude} onChange={(e) => setForm({...form, longitude: e.target.value})} />
            </div>

            <div className="form-row">
              <label className="form-label">Opening Time</label>
              <input type="time" name="openingTime" value={form.openingTime} onChange={(e) => setForm({...form, openingTime: e.target.value})} />
            </div>

            <div className="form-row">
              <label className="form-label">Closing Time</label>
              <input type="time" name="closingTime" value={form.closingTime} onChange={(e) => setForm({...form, closingTime: e.target.value})} />
            </div>

            <div className="form-row">
              <label className="form-label">Timezone</label>
              <input type="text" name="timezone" value={form.timezone} onChange={(e) => setForm({...form, timezone: e.target.value})} />
            </div>

            <div className="form-row">
              <label className="form-label">Delivery Radius (km)</label>
              <input type="number" name="deliveryRadius" value={form.deliveryRadius} onChange={(e) => setForm({...form, deliveryRadius: e.target.value})} />
              <p className="input-hint">Optional. Leave blank for no delivery radius limit.</p>
            </div>

            <div className="form-row">
              <label className="form-label">Status</label>
              <select name="status" value={form.status} onChange={(e) => setForm({...form, status: e.target.value})}>
                <option value={STATUS.ACTIVE}>Active</option>
                <option value={STATUS.INACTIVE}>Inactive</option>
              </select>
            </div>

            <div className="form-row">
              <label className="form-label">Delivery Enabled</label>
              <input type="checkbox" checked={form.deliveryEnabled} onChange={(e) => setForm({...form, deliveryEnabled: e.target.checked})} />
            </div>

            <div className="form-row">
              <label className="form-label">Pickup Enabled</label>
              <input type="checkbox" checked={form.pickupEnabled} onChange={(e) => setForm({...form, pickupEnabled: e.target.checked})} />
            </div>
          </div>

          <div className="form-actions form-actions-sticky">
            <button type="button" className="filament-btn filament-btn-outline" onClick={() => navigate("/branches")}>Cancel</button>
            {canSubmit && (
              <button type="submit" className="filament-btn filament-btn-primary" disabled={saving}>
                {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Branch"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
