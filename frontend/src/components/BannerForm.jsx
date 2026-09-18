import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getBanner,
  createBanner,
  updateBanner,
} from "../services/banners";
import Breadcrumb from "./Breadcrumb";
import MediaPicker from "./MediaPicker";
import {
  BANNER_STATUS,
  BANNER_POSITIONS,
  BANNER_POSITIONS_LABELS,
} from "@shared/constants";
import { useAuth } from "../context/AuthContext";

export default function BannerForm({ bannerId = null }) {
  const isEdit = Boolean(bannerId);
  const { can } = useAuth();
  const canSubmit = can(isEdit ? "banners.update" : "banners.create");
  const navigate = useNavigate();

  const [form, setForm] = useState({
    title: "",
    subtitle: "",
    image: "",
    link: "",
    position: BANNER_POSITIONS.HERO,
    sortOrder: 1,
    status: BANNER_STATUS.ACTIVE,
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
        const data = await getBanner(bannerId);

        if (!active) {
          return;
        }

        if (data.success) {
          const b = data.banner;

          setForm({
            title: b.title,
            subtitle: b.subtitle || "",
            image: b.image || "",
            link: b.link || "",
            position: b.position || BANNER_POSITIONS.HERO,
            sortOrder: b.sort_order ?? 1,
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
  }, [bannerId, isEdit]);

  function handleChange(e) {
    const { name, value } = e.target;

    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const newErrors = {};

    if (!form.title.trim()) {
      newErrors.title = "Title is required";
    }

    if (!form.image.trim()) {
      newErrors.image = "Please upload a banner image";
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const payload = {
        title: form.title,
        subtitle: form.subtitle,
        image: form.image,
        link: form.link || null,
        position: form.position,
        sortOrder: parseInt(form.sortOrder, 10) || 1,
        status: form.status,
      };

      const data = isEdit
        ? await updateBanner(bannerId, payload)
        : await createBanner(payload);

      if (!data.success) {
        setMessage(data.message);
        return;
      }

      navigate("/banners");
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
          { label: "Banners", to: "/banners" },
          { label: isEdit ? "Edit Banner" : "Create Banner" },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>{isEdit ? "Edit Banner" : "Create Banner"}</h1>
            <p className="filament-card-subtitle">
              {isEdit
                ? "Update the banner content, position and image."
                : "Add a promotional banner for the storefront."}
            </p>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/banners")}
            >
              ← Back to Banners
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
                <path d="M21 3H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7v2H7v2h10v-2h-3v-2h7a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Zm-1 11H4V5h16v9Z" />
              </svg>
              Banner Details
            </h2>

            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">
                  Title <span className="required">*</span>
                </label>
                <input
                  type="text"
                  name="title"
                  placeholder="e.g. Monsoon Sale – Up to 20% off"
                  value={form.title}
                  onChange={handleChange}
                  autoComplete="off"
                />
                {errors.title && <p className="input-error">{errors.title}</p>}
              </div>

              <div className="form-row">
                <label className="form-label">
                  Subtitle <span className="optional">(optional)</span>
                </label>
                <input
                  type="text"
                  name="subtitle"
                  value={form.subtitle}
                  onChange={handleChange}
                  autoComplete="off"
                />
              </div>

              <div className="form-row">
                <label className="form-label">Position</label>
                <select
                  name="position"
                  value={form.position}
                  onChange={handleChange}
                >
                  {Object.entries(BANNER_POSITIONS).map(([key, value]) => (
                    <option key={key} value={value}>
                      {BANNER_POSITIONS_LABELS[value]}
                    </option>
                  ))}
                </select>
                <p className="input-hint">
                  Hero appears in the main slider; promo in strip placements.
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

              <div className="form-row">
                <label className="form-label">Status</label>
                <select
                  name="status"
                  value={form.status}
                  onChange={handleChange}
                >
                  <option value={BANNER_STATUS.ACTIVE}>Active</option>
                  <option value={BANNER_STATUS.INACTIVE}>Inactive</option>
                </select>
                <p className="input-hint">
                  Inactive banners are hidden from the storefront.
                </p>
              </div>

              <div className="form-row">
                <label className="form-label">Link</label>
                <input
                  type="text"
                  name="link"
                  placeholder="e.g. /products or https://…"
                  value={form.link}
                  onChange={handleChange}
                  autoComplete="off"
                />
                <p className="input-hint">
                  Where the banner points when clicked.
                </p>
              </div>
            </div>

            <h2 className="form-section-title">Image</h2>

            <div className="form-row form-row-full">
              <MediaPicker
                label={
                  <>
                    Banner Image <span className="required">*</span>
                  </>
                }
                value={form.image}
                onChange={(url) =>
                  setForm((prev) => ({ ...prev, image: url }))
                }
                hint="Recommended ratio 21:9 for hero sliders, 3:1 for promo strips."
              />
              {errors.image && <p className="input-error">{errors.image}</p>}
            </div>

            <div className="form-actions form-actions-sticky">
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={() => navigate("/banners")}
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
                    : "Create Banner"}
              </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}