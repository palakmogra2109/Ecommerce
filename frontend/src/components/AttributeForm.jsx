import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getAttribute,
  createAttribute,
  updateAttribute,
} from "../services/attributes";
import Breadcrumb from "./Breadcrumb";
import { ATTRIBUTE_STATUS } from "@shared/constants";
import { useAuth } from "../context/AuthContext";

export default function AttributeForm({ attributeId = null }) {
  const isEdit = Boolean(attributeId);
  const { can } = useAuth();
  const canSubmit = can(isEdit ? "attributes.update" : "attributes.create");
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    slug: "",
    status: ATTRIBUTE_STATUS.ACTIVE,
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
        const data = await getAttribute(attributeId);

        if (!active) {
          return;
        }

        if (data.success) {
          const a = data.attribute;

          setForm({
            name: a.name,
            slug: a.slug,
            status: a.status,
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
  }, [attributeId, isEdit]);

  function handleChange(e) {
    const { name, value } = e.target;

    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const newErrors = {};

    if (!form.name.trim()) {
      newErrors.name = "Attribute name is required";
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
        status: form.status,
      };

      const data = isEdit
        ? await updateAttribute(attributeId, payload)
        : await createAttribute(payload);

      if (!data.success) {
        setMessage(data.message);
        return;
      }

      navigate("/attributes");
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
          { label: "Attributes", to: "/attributes" },
          { label: isEdit ? "Edit Attribute" : "Create Attribute" },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>{isEdit ? "Edit Attribute" : "Create Attribute"}</h1>
            <p className="filament-card-subtitle">
              {isEdit
                ? "Update the attribute name and slug."
                : "Add an attribute such as Weight, Colour or Size for product variants."}
            </p>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/attributes")}
            >
              ← Back to Attributes
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
                <path d="M3 5h18v2H3V5Zm0 6h18v2H3v-2Zm0 6h12v2H3v-2Z" />
              </svg>
              Attribute Details
            </h2>

            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">
                  Name <span className="required">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  placeholder="e.g. Weight"
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
                  placeholder="e.g. weight"
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
                  <option value={ATTRIBUTE_STATUS.ACTIVE}>Active</option>
                  <option value={ATTRIBUTE_STATUS.INACTIVE}>Inactive</option>
                </select>
                <p className="input-hint">
                  Inactive attributes cannot be assigned to products.
                </p>
              </div>
            </div>

            <div className="form-actions form-actions-sticky">
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={() => navigate("/attributes")}
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
                    : "Create Attribute"}
              </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}