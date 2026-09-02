import { useState } from "react";
import {
  createRole,
  updateRole,
} from "../services/roles";

const ROLE_STATUSES = ["ACTIVE", "INACTIVE"];

export default function RoleForm({
  role = null,
  onClose,
  onSaved,
}) {
  const isEdit = Boolean(role);

  const [form, setForm] = useState({
    name: role?.name ?? "",
    slug: role?.slug ?? "",
    description: role?.description ?? "",
    status: role?.status ?? "ACTIVE",
  });

  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    setErrors((prev) => ({
      ...prev,
      [name]: "",
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const newErrors = {};

    if (!form.name.trim()) {
      newErrors.name = "Role name is required";
    }

    if (
      form.slug &&
      !/^[a-z0-9_]+$/.test(form.slug)
    ) {
      newErrors.slug =
        "Slug can only contain lowercase letters, numbers, and underscores";
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const data = isEdit
        ? await updateRole(role.id, form)
        : await createRole(form);

      if (data.success) {
        onSaved(data.message);
      } else {
        setMessage(data.message);
      }
    } catch {
      setMessage(
        "Unable to connect to the server. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{isEdit ? "Edit Role" : "Create Role"}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="form-label">Name</label>
          <input
            type="text"
            name="name"
            placeholder="e.g. Content Manager"
            value={form.name}
            onChange={handleChange}
            autoComplete="off"
          />

          {errors.name && (
            <p className="input-error">{errors.name}</p>
          )}

          <label className="form-label">
            Slug <span className="optional">(optional)</span>
          </label>
          <input
            type="text"
            name="slug"
            placeholder="e.g. content_manager"
            value={form.slug}
            onChange={handleChange}
            autoComplete="off"
            disabled={isEdit}
          />

          {errors.slug && (
            <p className="input-error">{errors.slug}</p>
          )}

          <label className="form-label">Description</label>
          <textarea
            name="description"
            placeholder="Short description"
            value={form.description}
            onChange={handleChange}
            autoComplete="off"
            rows="3"
          />

          <label className="form-label">Status</label>
          <select
            name="status"
            value={form.status}
            onChange={handleChange}
          >
            {ROLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {message && (
            <p className="form-message">{message}</p>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
            >
              {loading
                ? "Saving..."
                : isEdit
                  ? "Save Changes"
                  : "Create Role"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}