import { useEffect, useState } from "react";
import {
  listRoles,
  deleteRole,
} from "../services/roles";
import RoleForm from "../components/RoleForm";
import RolePermissions from "../components/RolePermissions";

export default function Roles() {
  const [roles, setRoles] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [deletingRole, setDeletingRole] = useState(null);
  const [permissionsFor, setPermissionsFor] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const data = await listRoles({ search });

        if (!active) {
          return;
        }

        if (data.success) {
          setRoles(data.roles);
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
  }, [search, refreshKey]);

  function openCreate() {
    setEditingRole(null);
    setFormOpen(true);
  }

  function openEdit(role) {
    setEditingRole(role);
    setFormOpen(true);
  }

  function handleSaved(m) {
    setMessage(m);
    setFormOpen(false);
    setEditingRole(null);
    setRefreshKey((k) => k + 1);
  }

  async function handleDelete() {
    if (!deletingRole) {
      return;
    }

    try {
      const data = await deleteRole(deletingRole.id);

      if (data.success) {
        setMessage(`Role ${deletingRole.name} deleted`);
      } else {
        setMessage(data.message);
      }
    } catch {
      setMessage(
        "Unable to connect to the server. Please try again."
      );
    } finally {
      setDeletingRole(null);
      setRefreshKey((k) => k + 1);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Roles</h1>
        <button type="button" onClick={openCreate}>
          Add Role
        </button>
      </div>

      {message && (
        <p className="form-message">{message}</p>
      )}

      <div className="admin-filters">
        <input
          type="text"
          placeholder="Search roles"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Slug</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="5" className="admin-empty">
                  Loading...
                </td>
              </tr>
            ) : roles.length === 0 ? (
              <tr>
                <td colSpan="5" className="admin-empty">
                  No roles found
                </td>
              </tr>
            ) : (
              roles.map((role) => (
                <tr key={role.id}>
                  <td>{role.id}</td>
                  <td>{role.name}</td>
                  <td>{role.slug}</td>
                  <td>
                    <span
                      className={`status-badge status-${role.status.toLowerCase()}`}
                    >
                      {role.status}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => setPermissionsFor(role)}
                      >
                        Permissions
                      </button>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => openEdit(role)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        onClick={() => setDeletingRole(role)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <RoleForm
          role={editingRole}
          onClose={() => setFormOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {permissionsFor && (
        <RolePermissions
          role={permissionsFor}
          onClose={() => setPermissionsFor(null)}
          onSaved={handleSaved}
        />
      )}

      {deletingRole && (
        <div
          className="modal-overlay"
          onClick={() => setDeletingRole(null)}
        >
          <div
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Delete Role</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setDeletingRole(null)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <p className="confirm-text">
              Are you sure you want to delete{" "}
              <strong>{deletingRole.name}</strong>? This
              action cannot be undone.
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDeletingRole(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={handleDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}