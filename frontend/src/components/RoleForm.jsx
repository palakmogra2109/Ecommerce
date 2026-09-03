import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getRole,
  createRole,
  updateRole,
  getRolePermissions,
  updateRolePermissions,
} from "../services/roles";
import { listPermissions } from "../services/permissions";
import PermissionPicker from "../components/PermissionPicker";
import Breadcrumb from "../components/Breadcrumb";

export default function RoleForm({ roleId = null }) {
  const isEdit = Boolean(roleId);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    slug: "",
    description: "",
  });

  const [permissions, setPermissions] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        if (isEdit) {
          const [permData, roleData] = await Promise.all([
            getRolePermissions(roleId),
            getRole(roleId),
          ]);

          if (!active) {
            return;
          }

          if (roleData.success) {
            setForm({
              name: roleData.role.name,
              slug: roleData.role.slug,
              description: roleData.role.description ?? "",
            });
          } else {
            setMessage(roleData.message);
          }

          if (permData.success) {
            setPermissions(permData.permissions);
            setSelected(
              permData.selected.map((id) => Number(id))
            );
          } else {
            setMessage(permData.message);
          }
        } else {
          const permData = await listPermissions();

          if (!active) {
            return;
          }

          if (permData.success) {
            setPermissions(permData.permissions);
          } else {
            setMessage(permData.message);
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
  }, [roleId, isEdit]);

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

    setSaving(true);
    setMessage("");

    try {
      const data = isEdit
        ? await updateRole(roleId, form)
        : await createRole(form);

      if (!data.success) {
        setMessage(data.message);
        return;
      }

      const targetId = isEdit ? roleId : data.role.id;

      const permData = await updateRolePermissions(
        targetId,
        selected
      );

      if (permData.success) {
        navigate("/roles");
      } else {
        setMessage(permData.message);
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
    <div className="filament-page">
      <Breadcrumb
        items={[
          { label: "Roles", to: "/roles" },
          {
            label: isEdit ? "Edit Role" : "Create Role",
          },
        ]}
      />

      {message && (
        <div className="filament-alert">{message}</div>
      )}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>{isEdit ? "Edit Role" : "Create Role"}</h1>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/roles")}
            >
              ← Back to Roles
            </button>
          </div>
        </div>

        {loading ? (
          <div className="filament-empty">
            <div className="filament-spinner" />
          </div>
        ) : (
          <form className="admin-form" onSubmit={handleSubmit}>
            <div className="form-row">
              <label className="form-label">
                Name <span className="required">*</span>
              </label>
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
            </div>

            <div className="form-row">
              <label className="form-label">
                Slug{" "}
                <span className="optional">(auto-generated if blank)</span>
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
            </div>

            <div className="form-row">
              <label className="form-label">Description</label>
              <textarea
                name="description"
                placeholder="Short description"
                value={form.description}
                onChange={handleChange}
                autoComplete="off"
                rows="3"
              />
            </div>

            <div className="form-row">
              <label className="form-label">Permissions</label>
              <PermissionPicker
                permissions={permissions}
                selected={selected}
                onChange={setSelected}
              />
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="filament-btn filament-btn-primary"
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : isEdit
                    ? "Save Changes"
                    : "Create Role"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}