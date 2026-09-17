import { useEffect, useMemo, useState } from "react";
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
import { ROLE_SLUGS, ROLE_STATUS } from "@shared/constants";

function slugify(value) {
  return (value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default function RoleForm({ roleId = null }) {
  const normalizedRoleId =
    !roleId || roleId === "undefined" || roleId === "null"
      ? null
      : roleId;
  const isEdit = Boolean(normalizedRoleId);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    description: "",
    status: ROLE_STATUS.ACTIVE,
  });

  const [permissions, setPermissions] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [isSuperAdminRole, setIsSuperAdminRole] = useState(false);

  // Slug is hidden in the UI and always derived from the role name.
  const slugPreview = useMemo(() => slugify(form.name), [form.name]);

  // Counts shown in the permissions section header. All loaded
// permissions count so the figure always matches the picker.
  const visiblePerms = useMemo(() => permissions, [permissions]);
  const visibleSelectedCount = useMemo(
    () => visiblePerms.filter((p) => selected.includes(p.uuid)).length,
    [visiblePerms, selected]
  );

  useEffect(() => {
    let active = true;

    if (roleId && !normalizedRoleId) {
      setLoading(false);
      setMessage("Role not found");
      return () => {
        active = false;
      };
    }

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        if (isEdit) {
          const [permData, roleData] = await Promise.all([
            getRolePermissions(normalizedRoleId),
            getRole(normalizedRoleId),
          ]);

          if (!active) {
            return;
          }

          let protectedRole = false;

          if (roleData.success) {
            protectedRole =
              roleData.role.slug === ROLE_SLUGS.SUPER_ADMIN;

            setIsSuperAdminRole(protectedRole);

            setForm({
              name: roleData.role.name ?? "",
              description: roleData.role.description ?? "",
              status: roleData.role.status ?? ROLE_STATUS.ACTIVE,
            });

            if (protectedRole) {
              // Super admin always has every permission; show them all.
              const allPerms = await listPermissions({ limit: 100 });

              if (allPerms.success && active) {
                const list = Array.isArray(allPerms.permissions)
                  ? allPerms.permissions
                  : (allPerms.permissions?.rows ?? []);
                setPermissions(list);
                setSelected(list.map((p) => p.uuid));
              }
            }
          } else {
            setMessage(roleData.message);
          }

          if (permData.success && !protectedRole) {
            const list = Array.isArray(permData.permissions)
              ? permData.permissions
              : (permData.permissions?.rows ?? []);
            setPermissions(list);
            setSelected(
              (permData.selected || []).map((id) => String(id))
            );
          } else if (!permData.success && !protectedRole) {
            setMessage(permData.message);
          }
        } else {
          const permData = await listPermissions({ limit: 100 });

          if (!active) {
            return;
          }

          if (permData.success) {
            setPermissions(
              Array.isArray(permData.permissions)
                ? permData.permissions
                : (permData.permissions?.rows ?? [])
            );
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
  }, [normalizedRoleId, isEdit, roleId]);

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

    setMessage("");
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const newErrors = {};

    if (!form.name.trim()) {
      newErrors.name = "Role name is required";
    }

    if (form.name.trim().length > 80) {
      newErrors.name = "Role name must be 80 characters or less";
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        status: form.status,
        // Keep slug in sync with the name; backend slugifies it again.
        slug: slugify(form.name),
      };

      const data = isEdit
        ? await updateRole(normalizedRoleId, payload)
        : await createRole(payload);

      if (!data.success) {
        setMessage(data.message);
        return;
      }

      const targetId = isEdit
        ? normalizedRoleId
        : data.role.uuid;

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

      {isSuperAdminRole && (
        <div className="filament-alert filament-alert-info">
          Super admin role always has every permission and cannot be
          modified.
        </div>
      )}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>{isEdit ? "Edit Role" : "Create Role"}</h1>
            <p className="filament-card-subtitle">
              {isEdit
                ? "Update the role details and permission set."
                : "Define a new role and grant the permissions it needs."}
            </p>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/roles")}
            >
              Back
            </button>
          </div>
        </div>

        {loading ? (
          <div className="filament-empty">
            <div className="filament-spinner" />
          </div>
        ) : (
          <form
            className="admin-form role-form"
            onSubmit={handleSubmit}
          >
            <h2 className="form-section-title">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
              Role details
            </h2>

            <div className="form-grid">
              <div className="form-row">
                <label className="form-label" htmlFor="role-name">
                  Name <span className="required">*</span>
                </label>
                <input
                  type="text"
                  id="role-name"
                  name="name"
                  placeholder="e.g. Content Manager"
                  value={form.name}
                  onChange={handleChange}
                  autoComplete="off"
                  disabled={isSuperAdminRole}
                />
                {errors.name && (
                  <p className="input-error">{errors.name}</p>
                )}
                <p className="input-hint">
                  Slug: <code>{slugPreview || "will be auto-generated"}</code>
                </p>
              </div>

              <div className="form-row">
                <label className="form-label" htmlFor="role-status">
                  Status
                </label>
                <select
                  id="role-status"
                  name="status"
                  value={form.status}
                  onChange={handleChange}
                  disabled={isSuperAdminRole}
                >
                  <option value={ROLE_STATUS.ACTIVE}>Active</option>
                  <option value={ROLE_STATUS.INACTIVE}>Inactive</option>
                </select>
                <p className="input-hint">
                  Inactive roles cannot be assigned to users.
                </p>
              </div>

              <div className="form-row form-row-full">
                <label className="form-label" htmlFor="role-description">
                  Description
                </label>
                <textarea
                  id="role-description"
                  name="description"
                  rows={3}
                  placeholder="What is this role responsible for? e.g. Manages product catalogue and handles customer orders."
                  value={form.description}
                  onChange={handleChange}
                  disabled={isSuperAdminRole}
                />
                <p className="input-hint">
                  {form.description.trim().length}/300 characters
                </p>
              </div>
            </div>

            <h2 className="form-section-title form-section-title-mt">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 11.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
              </svg>
              Permissions
              <span className="form-section-badge">
                {visibleSelectedCount}
                /{visiblePerms.length} granted
              </span>
            </h2>

            <div className="form-row">
              <PermissionPicker
                permissions={permissions}
                selected={selected}
                onChange={setSelected}
                disabled={isSuperAdminRole}
              />
            </div>

            <div className="form-actions form-actions-sticky">
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                disabled={saving}
                onClick={() => navigate("/roles")}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="filament-btn filament-btn-primary"
                disabled={saving || isSuperAdminRole}
              >
                {isSuperAdminRole
                  ? "Protected"
                  : saving
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