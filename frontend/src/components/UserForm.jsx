import { useState } from "react";
import {
  createUser,
  updateUser,
} from "../services/users";
import {
  validateEmail,
  validatePassword,
} from "../utils/validation";

const USER_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED"];

export default function UserForm({
  user = null,
  onClose,
  onSaved,
}) {
  const isEdit = Boolean(user);

  const [form, setForm] = useState({
    name: user?.name ?? "",
    email: user?.email ?? "",
    password: "",
    status: user?.status ?? "ACTIVE",
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

    const emailError = validateEmail(form.email);

    if (emailError) {
      newErrors.email = emailError;
    }

    if (!isEdit) {
      const passwordError = validatePassword(form.password);

      if (passwordError) {
        newErrors.password = passwordError;
      }
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const data = isEdit
        ? await updateUser(user.id, form)
        : await createUser(form);

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
          <h2>{isEdit ? "Edit User" : "Create User"}</h2>
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
          <label className="form-label">
            Name <span className="optional">(optional)</span>
          </label>
          <input
            type="text"
            name="name"
            placeholder="Name"
            value={form.name}
            onChange={handleChange}
            autoComplete="off"
          />

          {errors.name && (
            <p className="input-error">{errors.name}</p>
          )}

          <label className="form-label">Email</label>
          <input
            type="email"
            name="email"
            placeholder="Email"
            value={form.email}
            onChange={handleChange}
            autoComplete="off"
            disabled={isEdit}
          />

          {errors.email && (
            <p className="input-error">{errors.email}</p>
          )}

          <label className="form-label">
            {isEdit
              ? "New Password (leave blank to keep)"
              : "Password"}
          </label>
          <input
            type="password"
            name="password"
            placeholder="Password"
            value={form.password}
            onChange={handleChange}
            autoComplete="new-password"
          />

          {errors.password && (
            <p className="input-error">{errors.password}</p>
          )}

          <label className="form-label">Status</label>
          <select
            name="status"
            value={form.status}
            onChange={handleChange}
          >
            {USER_STATUSES.map((s) => (
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
                  : "Create User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}