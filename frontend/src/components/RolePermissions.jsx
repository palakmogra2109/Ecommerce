import { useEffect, useState } from "react";
import {
  getRolePermissions,
  updateRolePermissions,
} from "../services/roles";

export default function RolePermissions({
  role,
  onClose,
  onSaved,
}) {
  const [permissions, setPermissions] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const data = await getRolePermissions(role.id);

        if (!active) {
          return;
        }

        if (data.success) {
          setPermissions(data.permissions);
          setSelected(data.selected.map((id) => Number(id)));
        } else {
          setMessage(data.message);
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
  }, [role.id]);

  const grouped = permissions.reduce((acc, permission) => {
    if (!acc[permission.module]) {
      acc[permission.module] = [];
    }
    acc[permission.module].push(permission);
    return acc;
  }, {});

  function toggle(permissionId) {
    setSelected((prev) =>
      prev.includes(permissionId)
        ? prev.filter((id) => id !== permissionId)
        : [...prev, permissionId]
    );
  }

  function toggleModule(slug, ids) {
    const moduleIds = ids.map((p) => p.id);
    const allSelected = moduleIds.every((id) =>
      selected.includes(id)
    );

    setSelected((prev) =>
      allSelected
        ? prev.filter((id) => !moduleIds.includes(id))
        : [...new Set([...prev, ...moduleIds])]
    );
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");

    try {
      const data = await updateRolePermissions(
        role.id,
        selected
      );

      if (data.success) {
        onSaved(`Permissions updated for ${role.name}`);
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
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-panel modal-wide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Permissions · {role.name}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {loading ? (
          <p className="admin-empty">Loading...</p>
        ) : (
          <div className="perm-groups">
            {Object.keys(grouped).length === 0 ? (
              <p className="admin-empty">
                No permissions available. Create some
                permissions first.
              </p>
            ) : (
              Object.entries(grouped).map(
                ([slug, perms]) => (
                  <div
                    key={slug}
                    className="perm-group"
                  >
                    <label className="perm-group-header">
                      <input
                        type="checkbox"
                        checked={perms.every((p) =>
                          selected.includes(p.id)
                        )}
                        onChange={() =>
                          toggleModule(slug, perms)
                        }
                      />
                      <strong>{slug}</strong>
                    </label>

                    <div className="perm-list">
                      {perms.map((permission) => (
                        <label
                          key={permission.id}
                          className="perm-item"
                        >
                          <input
                            type="checkbox"
                            checked={selected.includes(
                              permission.id
                            )}
                            onChange={() =>
                              toggle(permission.id)
                            }
                          />
                          <span>
                            {permission.name}
                            <code>
                              {permission.slug}
                            </code>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              )
            )}
          </div>
        )}

        {message && (
          <p className="form-message">{message}</p>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="button"
            disabled={saving || loading}
            onClick={handleSave}
          >
            {saving ? "Saving..." : "Save Permissions"}
          </button>
        </div>
      </div>
    </div>
  );
}