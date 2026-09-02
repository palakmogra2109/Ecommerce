import { useState } from "react";
import {
  createPermission,
  updatePermission,
} from "../services/permissions";

export default function PermissionForm({
  permission = null,
  modules = [],
  onClose,
  onSaved,
}) {
  const isEdit = Boolean(permission);

  const [form, setForm] = useState({
    name: permission?.name ?? "",
    slug: permission?.slug ?? "",
    module: permission?.module ?? modules[0] ?? "",
    description: permission?.description ?? "",
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
      newErrors.name = "Permission name is required";
    }

    if (!form.module) {
      newErrors.module = "Module is required";
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const data = isEdit
        ? await updatePermission(permission.id, form)
        : await createPermission(form);

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
          <h2>
            {isEdit
              ? "Edit Permission"
              : "Create Permission"}
          </h2>
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
            placeholder="e.g. View Users"
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
            placeholder="e.g. users.view"
            value={form.slug}
            onChange={handleChange}
            autoComplete="off"
            disabled={isEdit}
          />

          <label className="form-label">Module</label>
          <select
            name="module"
            value={form.module}
            onChange={handleChange}
          >
            {modules.length === 0 && (
              <option value="">Select a module</option>
            )}
            {modules.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.name}
              </option>
            ))}
          </select>

          {errors.module && (
            <p className="input-error">{errors.module}</p>
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
                  : "Create Permission"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}