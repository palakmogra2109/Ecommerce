import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getCoupon,
  createCoupon,
  updateCoupon,
} from "../services/coupons";
import Breadcrumb from "./Breadcrumb";
import {
  COUPON_TYPE,
  COUPON_TYPE_LABELS,
  COUPON_STATUS,
  COUPON_LIMITS,
} from "@shared/constants";
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

export default function CouponForm({ couponId = null }) {
  const isEdit = Boolean(couponId);
  const { can } = useAuth();
  const canSubmit = can(isEdit ? "coupons.update" : "coupons.create");
  const navigate = useNavigate();

  const [form, setForm] = useState({
    code: "",
    type: COUPON_TYPE.PERCENTAGE,
    value: "",
    minOrderAmount: "",
    maxDiscountAmount: "",
    startsAt: "",
    endsAt: "",
    usageLimit: "",
    perCustomerLimit: 1,
    description: "",
    status: COUPON_STATUS.ACTIVE,
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
        const data = await getCoupon(couponId);

        if (!active) {
          return;
        }

        if (data.success) {
          const c = data.coupon;

          setForm({
            code: c.code,
            type: c.type,
            value: c.value ?? "",
            minOrderAmount: c.min_order_amount ?? "",
            maxDiscountAmount: c.max_discount_amount ?? "",
            startsAt: toLocalInput(c.starts_at),
            endsAt: toLocalInput(c.ends_at),
            usageLimit: c.usage_limit ?? "",
            perCustomerLimit: c.per_customer_limit ?? 1,
            description: c.description || "",
            status: c.status,
          });
        } else {
          setMessage(data.message);
        }
      } catch {
        if (!active) {
          return;
        }

        setMessage("Unable to connect to the server. Please try again.");
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
  }, [couponId, isEdit]);

  function handleChange(e) {
    const { name, value } = e.target;

    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const newErrors = {};

    if (!form.code.trim()) {
      newErrors.code = "Coupon code is required";
    } else if (form.code.trim().length > COUPON_LIMITS.MAX_CODE_LENGTH) {
      newErrors.code = `Code cannot exceed ${COUPON_LIMITS.MAX_CODE_LENGTH} characters`;
    }

    if (form.value === "" || form.value == null) {
      newErrors.value = "Discount value is required";
    } else {
      const value = Number(form.value);

      if (form.type === COUPON_TYPE.PERCENTAGE) {
        if (value < COUPON_LIMITS.MIN_PERCENTAGE) {
          newErrors.value = `Minimum is ${COUPON_LIMITS.MIN_PERCENTAGE}%`;
        } else if (value > COUPON_LIMITS.MAX_PERCENTAGE) {
          newErrors.value = `Maximum is ${COUPON_LIMITS.MAX_PERCENTAGE}%`;
        }
      } else if (value < COUPON_LIMITS.MIN_FIXED_AMOUNT) {
        newErrors.value = "Discount cannot be less than 1";
      }
    }

    if (form.endsAt && form.startsAt && form.endsAt < form.startsAt) {
      newErrors.endsAt = "End date must be after the start date";
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const payload = {
        code: form.code,
        type: form.type,
        value: form.value,
        minOrderAmount: form.minOrderAmount || 0,
        maxDiscountAmount: form.maxDiscountAmount === "" ? null : form.maxDiscountAmount,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        usageLimit: form.usageLimit === "" ? null : form.usageLimit,
        perCustomerLimit: form.perCustomerLimit,
        description: form.description,
        status: form.status,
      };

      const data = isEdit
        ? await updateCoupon(couponId, payload)
        : await createCoupon(payload);

      if (!data.success) {
        setMessage(data.message);
        return;
      }

      navigate("/coupons");
    } catch {
      setMessage("Unable to connect to the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="filament-page">
      <Breadcrumb
        items={[
          { label: "Coupons", to: "/coupons" },
          { label: isEdit ? "Edit Coupon" : "Create Coupon" },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>{isEdit ? "Edit Coupon" : "Create Coupon"}</h1>
            <p className="filament-card-subtitle">
              {isEdit
                ? "Update the discount, limits and validity window."
                : "Create a discount code customers can apply at checkout."}
            </p>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/coupons")}
            >
              ← Back to Coupons
            </button>
          </div>
        </div>

        {loading ? (
          <div className="filament-empty">
            <div className="filament-spinner" />
          </div>
        ) : (
          <form className="admin-form resource-form" onSubmit={handleSubmit}>
            <h2 className="form-section-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21.41 11.58l-9-9A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 .59 1.42l9 9A2 2 0 0 0 13 22a2 2 0 0 0 1.41-.59l7-7A2 2 0 0 0 22 13a2 2 0 0 0-.59-1.42ZM6.5 8A1.5 1.5 0 1 1 8 6.5 1.5 1.5 0 0 1 6.5 8Z" />
              </svg>
              Coupon Details
            </h2>

            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">
                  Code <span className="required">*</span>
                </label>
                <input
                  type="text"
                  name="code"
                  placeholder="e.g. WELCOME10"
                  value={form.code}
                  onChange={handleChange}
                  autoComplete="off"
                />
                {errors.code ? (
                  <p className="input-error">{errors.code}</p>
                ) : (
                  <p className="input-hint">
                    Case-insensitive. Spaces become dashes.
                  </p>
                )}
              </div>

              <div className="form-row">
                <label className="form-label">Type</label>
                <select name="type" value={form.type} onChange={handleChange}>
                  {Object.values(COUPON_TYPE).map((type) => (
                    <option key={type} value={type}>
                      {COUPON_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
                <p className="input-hint">
                  Percentage takes a cut off the cart; fixed removes a flat
                  amount.
                </p>
              </div>

              <div className="form-row">
                <label className="form-label">
                  Discount Value <span className="required">*</span>
                </label>
                <input
                  type="number"
                  name="value"
                  step="0.01"
                  min="0"
                  placeholder={
                    form.type === COUPON_TYPE.PERCENTAGE ? "e.g. 10" : "e.g. 200"
                  }
                  value={form.value}
                  onChange={handleChange}
                />
                {errors.value && <p className="input-error">{errors.value}</p>}
              </div>

              <div className="form-row">
                <label className="form-label">Status</label>
                <select
                  name="status"
                  value={form.status}
                  onChange={handleChange}
                >
                  <option value={COUPON_STATUS.ACTIVE}>Active</option>
                  <option value={COUPON_STATUS.INACTIVE}>Inactive</option>
                </select>
                <p className="input-hint">
                  Inactive coupons are rejected at checkout.
                </p>
              </div>
            </div>

            <h2 className="form-section-title">Eligibility &amp; Limits</h2>

            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">Minimum Order Amount</label>
                <input
                  type="number"
                  name="minOrderAmount"
                  step="0.01"
                  min="0"
                  value={form.minOrderAmount}
                  onChange={handleChange}
                />
                <p className="input-hint">Cart total required before applying.</p>
              </div>

              <div className="form-row">
                <label className="form-label">
                  Max Discount{" "}
                  <span className="optional">(percentage only)</span>
                </label>
                <input
                  type="number"
                  name="maxDiscountAmount"
                  step="0.01"
                  min="0"
                  value={form.maxDiscountAmount}
                  onChange={handleChange}
                />
                <p className="input-hint">Caps the discount for % coupons.</p>
              </div>

              <div className="form-row">
                <label className="form-label">Usage Limit</label>
                <input
                  type="number"
                  name="usageLimit"
                  min="0"
                  value={form.usageLimit}
                  onChange={handleChange}
                />
                <p className="input-hint">
                  Total redemptions allowed. Leave blank for unlimited.
                </p>
              </div>

              <div className="form-row">
                <label className="form-label">Per-Customer Limit</label>
                <input
                  type="number"
                  name="perCustomerLimit"
                  min="1"
                  value={form.perCustomerLimit}
                  onChange={handleChange}
                />
                <p className="input-hint">
                  How many times one customer may use it.
                </p>
              </div>
            </div>

            <h2 className="form-section-title">Validity Window</h2>

            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">Starts At</label>
                <input
                  type="datetime-local"
                  name="startsAt"
                  value={form.startsAt}
                  onChange={handleChange}
                />
              </div>

              <div className="form-row">
                <label className="form-label">Ends At</label>
                <input
                  type="datetime-local"
                  name="endsAt"
                  value={form.endsAt}
                  onChange={handleChange}
                />
                {errors.endsAt && (
                  <p className="input-error">{errors.endsAt}</p>
                )}
              </div>
            </div>

            <div className="form-row form-row-full">
              <label className="form-label">Description</label>
              <textarea
                name="description"
                rows="3"
                placeholder="Shown to customers, e.g. 10% off your first order."
                value={form.description}
                onChange={handleChange}
              />
            </div>

            <div className="form-actions form-actions-sticky">
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={() => navigate("/coupons")}
              >
                Cancel
              </button>
              {canSubmit && (
              <button
                type="submit"
                className="filament-btn filament-btn-primary"
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : isEdit
                    ? "Save Changes"
                    : "Create Coupon"}
              </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}