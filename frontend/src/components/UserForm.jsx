import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getUser,
  createUser,
  updateUser,
} from "../services/users";
import { listRoles } from "../services/roles";
import { uploadMedia, mediaUrl } from "../services/media";
import Breadcrumb from "../components/Breadcrumb";
import Avatar from "../components/Avatar";
import {
  validateEmail,
  validatePassword,
} from "../utils/validation";

export default function UserForm({ userId = null }) {
  const isEdit = Boolean(userId);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    email: "",
    mobile: "",
    password: "",
    avatar: null,
  });

  const [roles, setRoles] = useState([]);
  const [roleId, setRoleId] = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(isEdit);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        const rolesData = await listRoles();

        if (!active) {
          return;
        }

        if (rolesData.success) {
          setRoles(rolesData.roles);
        }

        if (isEdit) {
          const userData = await getUser(userId);

          if (!active) {
            return;
          }

          if (userData.success) {
            const u = userData.user;

            setForm({
              name: u.name ?? "",
              email: u.email,
              mobile: u.mobile ?? "",
              password: "",
              avatar: u.avatar ?? null,
            });

            setPreview(u.avatar ? mediaUrl(u.avatar) : null);

            if (u.role) {
              setRoleId(String(u.role.id));
            }
          } else {
            setMessage(userData.message);
          }
        }
      } catch {
        if (!active) {
          return;
        }

        setMessage(
          "Unable to connect to the server. Please try again."
        );
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
  }, [userId, isEdit]);

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

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];

    if (!file) {
      return;
    }

    setUploading(true);
    setMessage("");

    try {
      const data = await uploadMedia(file);

      if (data.success) {
        setForm((prev) => ({
          ...prev,
          avatar: data.url,
        }));

        setPreview(mediaUrl(data.url));
      } else {
        setMessage(data.message);
      }
    } catch {
      setMessage(
        "Unable to upload image. Please try again."
      );
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function handleRemoveAvatar() {
    setForm((prev) => ({
      ...prev,
      avatar: null,
    }));

    setPreview(null);
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

    setSaving(true);
    setMessage("");

    try {
      const data = isEdit
        ? await updateUser(userId, {
            name: form.name,
            mobile: form.mobile,
            avatar: form.avatar,
            password: form.password || undefined,
            ...(roleId ? { roleId } : {}),
          })
        : await createUser({
            name: form.name,
            email: form.email,
            mobile: form.mobile,
            avatar: form.avatar,
            password: form.password,
            ...(roleId ? { roleId } : {}),
          });

      if (data.success) {
        navigate("/users");
      } else {
        setMessage(data.message);
      }
    } catch {
      setMessage(
        "Unable to connect to the server. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-page">
      <Breadcrumb
        items={[
          { label: "Users", to: "/users" },
          {
            label: isEdit ? "Edit User" : "Create User",
          },
        ]}
      />

      <div className="admin-header">
        <h1>{isEdit ? "Edit User" : "Create User"}</h1>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => navigate("/users")}
        >
          ← Back to Users
        </button>
      </div>

      {loading ? (
        <p className="admin-empty">Loading...</p>
      ) : (
        <form className="admin-form" onSubmit={handleSubmit}>
          <label className="form-label">Profile Image</label>
          <div className="avatar-upload">
            <Avatar user={form} size={80} />

            <div className="avatar-upload-actions">
              <label className="btn-secondary avatar-file-btn">
                {uploading ? "Uploading..." : "Upload Image"}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  disabled={uploading}
                />
              </label>

              {(preview || form.avatar) && (
                <button
                  type="button"
                  className="btn-danger btn-sm"
                  onClick={handleRemoveAvatar}
                >
                  Remove
                </button>
              )}
            </div>
          </div>

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

          <label className="form-label">Mobile Number</label>
          <input
            type="tel"
            name="mobile"
            placeholder="Mobile number"
            value={form.mobile}
            onChange={handleChange}
            autoComplete="off"
          />

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

          <label className="form-label">Role</label>
          <select
            name="roleId"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
          >
            <option value="">Select role</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>

          {message && (
            <p className="form-message">{message}</p>
          )}

          <div className="form-actions">
            <button type="submit" disabled={saving}>
              {saving
                ? "Saving..."
                : isEdit
                  ? "Save Changes"
                  : "Create User"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}