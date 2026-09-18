import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getCategory,
  createCategory,
  updateCategory,
  listCategories,
} from "../services/categories";
import Breadcrumb from "./Breadcrumb";
import MediaPicker from "./MediaPicker";
import { STATUS } from "@shared/constants";
import { useAuth } from "../context/AuthContext";

export default function CategoriesForm({ categoryId = null, subCategory = false }) {
  const isEdit = Boolean(categoryId);
  const { can } = useAuth();
  const canSubmit = can(isEdit ? "categories.update" : "categories.create");
  const navigate = useNavigate();

  const basePath = subCategory ? "/sub-categories" : "/categories";
  const entityLabel = subCategory ? "Sub Category" : "Category";

  const [form, setForm] = useState({
    name: "",
    slug: "",
    description: "",
    image: "",
    parentUuid: "",
    status: STATUS.ACTIVE,
    sortOrder: 0,
    metaTitle: "",
    metaDescription: "",
  });

  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const data = await listCategories({ all: 1, status: STATUS.ACTIVE });

        if (active && data.success) {
          setOptions(
            (data.categories || []).filter(
              (c) =>
                (!categoryId || c.uuid !== categoryId) &&
                // Sub categories can only attach to top-level categories.
                (!subCategory || !c.parent_uuid)
            )
          );
        }
      } catch {
        // Options are non-critical; ignore silently.
      }
    };

    run();

    return () => {
      active = false;
    };
  }, [categoryId, subCategory]);

  useEffect(() => {
    if (!isEdit) {
      return;
    }

    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        const data = await getCategory(categoryId);

        if (!active) {
          return;
        }

        if (data.success) {
          const c = data.category;

          setForm({
            name: c.name,
            slug: c.slug,
            description: c.description || "",
            image: c.image || "",
            parentUuid: c.parent_uuid || "",
            status: c.status,
            sortOrder: c.sort_order ?? 0,
            metaTitle: c.meta_title || "",
            metaDescription: c.meta_description || "",
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
  }, [categoryId, isEdit]);

  function handleChange(e) {
    const { name, value } = e.target;

    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const newErrors = {};

    if (!form.name.trim()) {
      newErrors.name = "Category name is required";
    }

    if (subCategory && !form.parentUuid) {
      newErrors.parentUuid = "Please select a parent category";
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
        image: form.image || null,
        parentUuid: form.parentUuid || null,
        status: form.status,
        sortOrder: parseInt(form.sortOrder, 10) || 0,
        metaTitle: form.metaTitle,
        metaDescription: form.metaDescription,
      };

      const data = isEdit
        ? await updateCategory(categoryId, payload)
        : await createCategory(payload);

      if (!data.success) {
        setMessage(data.message);
        return;
      }

      navigate(basePath);
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
          { label: subCategory ? "Sub Categories" : "Categories", to: basePath },
          { label: isEdit ? `Edit ${entityLabel}` : `Create ${entityLabel}` },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>
              {isEdit ? `Edit ${entityLabel}` : `Create ${entityLabel}`}
            </h1>
            <p className="filament-card-subtitle">
              {isEdit
                ? `Update the ${entityLabel.toLowerCase()} details and SEO settings.`
                : subCategory
                  ? "Add a sub category and link it to a parent category."
                  : "Add a top-level category to organise your catalogue."}
            </p>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate(basePath)}
            >
              ← Back to {subCategory ? "Sub Categories" : "Categories"}
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
                <path d="M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 0h8v8h-8v-8Z" />
              </svg>
              {entityLabel} Details
            </h2>

            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">
                  Name <span className="required">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  placeholder="e.g. Grains & Pulses"
                  value={form.name}
                  onChange={handleChange}
                  autoComplete="off"
                />
                {errors.name && <p className="input-error">{errors.name}</p>}
              </div>

              <div className="form-row">
                <label className="form-label">
                  Slug {" "}
                  <span className="optional">(auto-generated if blank)</span>
                </label>
                <input
                  type="text"
                  name="slug"
                  placeholder="e.g. grains-pulses"
                  value={form.slug}
                  onChange={handleChange}
                  autoComplete="off"
                  disabled={isEdit}
                />
                {errors.slug && <p className="input-error">{errors.slug}</p>}
              </div>

              <div className="form-row">
                <label className="form-label">
                  Parent Category{" "}
                  {subCategory && <span className="required">*</span>}
                </label>
                <select
                  name="parentUuid"
                  value={form.parentUuid}
                  onChange={handleChange}
                >
                  <option value="">
                    {subCategory ? "Select a parent category" : "None (top level)"}
                  </option>
                  {options.map((option) => (
                    <option key={option.uuid} value={option.uuid}>
                      {option.name}
                    </option>
                  ))}
                </select>
                {errors.parentUuid && (
                  <p className="input-error">{errors.parentUuid}</p>
                )}
                <p className="input-hint">
                  {subCategory
                    ? "Sub categories are grouped under their parent."
                    : "Leave as top level for a main menu category."}
                </p>
              </div>

              <div className="form-row">
                <label className="form-label">Status</label>
                <select
                  name="status"
                  value={form.status}
                  onChange={handleChange}
                >
                  <option value={STATUS.ACTIVE}>Active</option>
                  <option value={STATUS.INACTIVE}>Inactive</option>
                </select>
                <p className="input-hint">
                  Inactive categories are hidden from the storefront.
                </p>
              </div>

              <div className="form-row">
                <label className="form-label">Sort Order</label>
                <input
                  type="number"
                  name="sortOrder"
                  value={form.sortOrder}
                  onChange={handleChange}
                />
                <p className="input-hint">Lower numbers appear first.</p>
              </div>

              <div className="form-row form-row-full">
                <label className="form-label">Description</label>
                <textarea
                  name="description"
                  rows="3"
                  placeholder="Short description shown on the category page."
                  value={form.description}
                  onChange={handleChange}
                />
              </div>
            </div>

            <h2 className="form-section-title">Media</h2>

            <div className="form-row form-row-full">
              <MediaPicker
                label={`${entityLabel} Image`}
                value={form.image}
                onChange={(url) =>
                  setForm((prev) => ({ ...prev, image: url }))
                }
                hint="Square images (1:1) work best across the catalogue."
              />
            </div>

            <h2 className="form-section-title">Search Engine Optimisation</h2>

            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">Meta Title</label>
                <input
                  type="text"
                  name="metaTitle"
                  value={form.metaTitle}
                  onChange={handleChange}
                  autoComplete="off"
                />
                <p className="input-hint">
                  {form.metaTitle.length}/60 characters
                </p>
              </div>

              <div className="form-row">
                <label className="form-label">Meta Description</label>
                <textarea
                  name="metaDescription"
                  rows="2"
                  value={form.metaDescription}
                  onChange={handleChange}
                />
                <p className="input-hint">
                  {form.metaDescription.length}/160 characters
                </p>
              </div>
            </div>

            <div className="form-actions form-actions-sticky">
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={() => navigate(basePath)}
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
                    : `Create ${entityLabel}`}
              </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}