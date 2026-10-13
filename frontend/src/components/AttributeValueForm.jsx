import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getAttributeValue,
  createAttributeValue,
  updateAttributeValue,
} from "../services/attributeValues";
import { listAttributes } from "../services/attributes";
import Breadcrumb from "./Breadcrumb";
import { ATTRIBUTE_STATUS } from "@shared/constants";
import { useAuth } from "../context/AuthContext";

// Create / edit for a single attribute VALUE — the "Black" under "Colour".
//
// The attribute a value belongs to is chosen by NAME from a dropdown, never typed
// as an id. The selected option carries that attribute's uuid, which is what goes
// on the wire; the server resolves it to the numeric parent_id (see
// lib/models/attributeValue.js). The resolved numeric id is shown read-only
// underneath so the link is visible rather than implied.
//
// A value cannot exist without its attribute, so unlike a category's optional
// parent this field is required, and it is validated again on the server.
export default function AttributeValueForm({ valueId = null }) {
  const isEdit = Boolean(valueId);
  const { can } = useAuth();
  const canSubmit = can(isEdit ? "attributes.update" : "attributes.create");
  const navigate = useNavigate();

  const [attributes, setAttributes] = useState([]);
  const [form, setForm] = useState({
    name: "",
    slug: "",
    parentUuid: "",
    status: ATTRIBUTE_STATUS.ACTIVE,
  });

  // The numeric parent_id the server resolved, shown read-only.
  const [resolvedParentId, setResolvedParentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        const [attrData, valueData] = await Promise.all([
          // Only a top-level attribute can be a parent, so values are excluded here.
          listAttributes({ all: 1, type: "parent" }),
          isEdit ? getAttributeValue(valueId) : Promise.resolve(null),
        ]);

        if (!active) {
          return;
        }

        if (attrData.success) {
          setAttributes(attrData.attributes || []);
        }

        if (isEdit) {
          if (valueData?.success) {
            const v = valueData.value;

            setForm({
              name: v.name || "",
              slug: v.slug || "",
              parentUuid: v.parent_uuid || "",
              status: v.status || ATTRIBUTE_STATUS.ACTIVE,
            });
            setResolvedParentId(
              v.parent_id != null ? String(v.parent_id) : ""
            );
          } else {
            setMessage(valueData?.message || "Unable to load this value");
          }
        }
      } catch {
        if (active) {
          setMessage("Unable to connect to the server. Please try again.");
        }
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
  }, [valueId, isEdit]);

  function handleChange(e) {
    const { name, value } = e.target;

    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const newErrors = {};

    if (!form.name.trim()) {
      newErrors.name = "Value name is required";
    }

    if (!form.parentUuid) {
      newErrors.parentUuid = "Select the attribute this value belongs to";
    }

    if (form.slug && !/^[a-z0-9-]+$/.test(form.slug)) {
      newErrors.slug =
        "Slug can only contain lowercase letters, numbers, and dashes";
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
        parentUuid: form.parentUuid,
        status: form.status,
      };

      const data = isEdit
        ? await updateAttributeValue(valueId, payload)
        : await createAttributeValue(payload);

      if (!data.success) {
        setMessage(data.message);
        return;
      }

      navigate("/attribute-values");
    } catch {
      setMessage("Unable to connect to the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const selectedAttribute = attributes.find(
    (a) => a.uuid === form.parentUuid
  );

  return (
    <div className="filament-page">
      <Breadcrumb
        items={[
          { label: "Attribute Values", to: "/attribute-values" },
          { label: isEdit ? "Edit Value" : "Create Value" },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>{isEdit ? "Edit Attribute Value" : "Create Attribute Value"}</h1>
            <p className="filament-card-subtitle">
              A value belongs to exactly one attribute — for example “Black”
              under “Colour”. The same value name may exist under a different
              attribute.
            </p>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/attribute-values")}
            >
              ← Back to Attribute Values
            </button>
          </div>
        </div>

        {loading ? (
          <div className="filament-empty">
            <div className="filament-spinner" />
          </div>
        ) : (
          <form className="admin-form resource-form" onSubmit={handleSubmit}>
            <div className="form-row">
              <label className="form-label">
                Attribute <span className="required">*</span>
              </label>
              <select
                name="parentUuid"
                value={form.parentUuid}
                onChange={handleChange}
              >
                <option value="">— Select attribute —</option>
                {attributes.map((a) => (
                  <option key={a.uuid} value={a.uuid}>
                    {a.name}
                  </option>
                ))}
              </select>
              {/* The dropdown carries the uuid; this is the id it resolves to,
                  shown so the parent link is explicit rather than hidden. */}
              <p className="input-hint">
                {selectedAttribute
                  ? `parent_id: ${resolvedParentId || "assigned on save"}`
                  : "Values are grouped under this attribute."}
              </p>
              {errors.parentUuid && (
                <p className="input-error">{errors.parentUuid}</p>
              )}
            </div>

            <div className="form-row">
              <label className="form-label">
                Value <span className="required">*</span>
              </label>
              <input
                type="text"
                name="name"
                placeholder='Value, e.g. "Black" or "5kg"'
                value={form.name}
                onChange={handleChange}
                autoComplete="off"
              />
              {errors.name && <p className="input-error">{errors.name}</p>}
            </div>

            <div className="form-row">
              <label className="form-label">
                Slug <span className="optional">(optional)</span>
              </label>
              <input
                type="text"
                name="slug"
                placeholder="auto-generated from the value if blank"
                value={form.slug}
                onChange={handleChange}
                autoComplete="off"
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
            </div>

            <div className="form-actions form-actions-sticky">
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={() => navigate("/attribute-values")}
              >
                Cancel
              </button>
              {canSubmit && (
                <button
                  type="submit"
                  className="filament-btn filament-btn-primary"
                  disabled={saving}
                >
                  {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Value"}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
