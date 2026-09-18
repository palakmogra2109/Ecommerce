import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getBrand,
  createBrand,
  updateBrand,
} from "../services/brands";
import Breadcrumb from "./Breadcrumb";
import MediaPicker from "./MediaPicker";
import { BRAND_STATUS } from "@shared/constants";
import { useAuth } from "../context/AuthContext";

export default function BrandForm({ brandId = null }) {
  const isEdit = Boolean(brandId);
  const { can } = useAuth();
  const canSubmit = can(isEdit ? "brands.update" : "brands.create");
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    slug: "",
    description: "",
    logo: "",
    status: BRAND_STATUS.ACTIVE,
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
        const data = await getBrand(brandId);

        if (!active) {
          return;
        }

        if (data.success) {
          const b = data.brand;

          setForm({
            name: b.name,
            slug: b.slug,
            description: b.description || "",
            logo: b.logo || "",
            status: b.status,
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
  }, [brandId, isEdit]);

  function handleChange(e) {
    const { name, value } = e.target;

    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const newErrors = {};

    if (!form.name.trim()) {
      newErrors.name = "Brand name is required";
    }

    if (form.slug && !/^[a-z0-9-]+$/.test(form.slug)) {
      newErrors.slug = "Slug can only contain lowercase letters, numbers, and dashes";
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const payload = {
        name: form.name,
        slug: form.slug,
        description: form.description,
        logo: form.logo || null,
        status: form.status,
      };

      const data = isEdit
        ? await updateBrand(brandId, payload)
        : await createBrand(payload);

      if (!data.success) {
        setMessage(data.message);
        return;
      }

      navigate("/brands");
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
          { label: "Brands", to: "/brands" },
          { label: isEdit ? "Edit Brand" : "Create Brand" },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>{isEdit ? "Edit Brand" : "Create Brand"}</h1>
            <p className="filament-card-subtitle">
              {isEdit
                ? "Update the brand details and logo."
                : "Add a brand and associate it with your products."}
            </p>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/brands")}
            >
              ← Back to Brands
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
              Brand Details
            </h2>

            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">
                  Name <span className="required">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  placeholder="e.g. TerraFields"
                  value={form.name}
                  onChange={handleChange}
                  autoComplete="off"
                />
                {errors.name && <p className="input-error">{errors.name}</p>}
              </div>

              <div className="form-row">
                <label className="form-label">
                  Slug{" "}
                  <span className="optional">(auto-generated if blank)</span>
                </label>
                <input
                  type="text"
                  name="slug"
                  placeholder="e.g. terrafields"
                  value={form.slug}
                  onChange={handleChange}
                  autoComplete="off"
                  disabled={isEdit}
                />
                {errors.slug && <p className="input-error">{errors.slug}</p>}
              </div>

              <div className="form-row">
                <label className="form-label">Status</label>
                <select
                  name="status"
                  value={form.status}
                  onChange={handleChange}
                >
                  <option value={BRAND_STATUS.ACTIVE}>Active</option>
                  <option value={BRAND_STATUS.INACTIVE}>Inactive</option>
                </select>
                <p className="input-hint">
                  Inactive brands are hidden from the storefront.
                </p>
              </div>

              <div className="form-row form-row-full">
                <label className="form-label">Description</label>
                <textarea
                  name="description"
                  rows="4"
                  placeholder="Tell customers about this brand."
                  value={form.description}
                  onChange={handleChange}
                />
              </div>
            </div>

            <h2 className="form-section-title">Logo</h2>

            <div className="form-row form-row-full">
              <MediaPicker
                label="Brand Logo"
                value={form.logo}
                onChange={(url) =>
                  setForm((prev) => ({ ...prev, logo: url }))
                }
                hint="Transparent PNG or SVG works best, around 400×400."
              />
            </div>

            <div className="form-actions form-actions-sticky">
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={() => navigate("/brands")}
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
                    : "Create Brand"}
              </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}