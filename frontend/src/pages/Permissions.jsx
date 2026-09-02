import { useEffect, useState } from "react";
import {
  listPermissions,
  deletePermission,
} from "../services/permissions";
import PermissionForm from "../components/PermissionForm";

export default function Permissions() {
  const [permissions, setPermissions] = useState([]);
  const [modules, setModules] = useState([]);
  const [search, setSearch] = useState("");
  const [module, setModule] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingPermission, setEditingPermission] = useState(null);
  const [deletingPermission, setDeletingPermission] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const data = await listPermissions({
          module,
          search,
        });

        if (!active) {
          return;
        }

        if (data.success) {
          setPermissions(data.permissions);
          setModules(data.modules);
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
  }, [module, search, refreshKey]);

  function openCreate() {
    setEditingPermission(null);
    setFormOpen(true);
  }

  function openEdit(permission) {
    setEditingPermission(permission);
    setFormOpen(true);
  }

  function handleSaved(m) {
    setMessage(m);
    setFormOpen(false);
    setEditingPermission(null);
    setRefreshKey((k) => k + 1);
  }

  async function handleDelete() {
    if (!deletingPermission) {
      return;
    }

    try {
      const data = await deletePermission(
        deletingPermission.id
      );

      if (data.success) {
        setMessage(
          `Permission ${deletingPermission.name} deleted`
        );
      } else {
        setMessage(data.message);
      }
    } catch {
      setMessage(
        "Unable to connect to the server. Please try again."
      );
    } finally {
      setDeletingPermission(null);
      setRefreshKey((k) => k + 1);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Permissions</h1>
        <button type="button" onClick={openCreate}>
          Add Permission
        </button>
      </div>

      {message && (
        <p className="form-message">{message}</p>
      )}

      <div className="admin-filters">
        <input
          type="text"
          placeholder="Search permissions"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select
          value={module}
          onChange={(e) => setModule(e.target.value)}
        >
          <option value="">All modules</option>
          {modules.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Slug</th>
              <th>Module</th>
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
            ) : permissions.length === 0 ? (
              <tr>
                <td colSpan="5" className="admin-empty">
                  No permissions found
                </td>
              </tr>
            ) : (
              permissions.map((permission) => (
                <tr key={permission.id}>
                  <td>{permission.id}</td>
                  <td>{permission.name}</td>
                  <td>{permission.slug}</td>
                  <td>
                    <span className="status-badge status-active">
                      {permission.module}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => openEdit(permission)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        onClick={() =>
                          setDeletingPermission(permission)
                        }
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
        <PermissionForm
          permission={editingPermission}
          modules={modules}
          onClose={() => setFormOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {deletingPermission && (
        <div
          className="modal-overlay"
          onClick={() => setDeletingPermission(null)}
        >
          <div
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Delete Permission</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setDeletingPermission(null)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <p className="confirm-text">
              Are you sure you want to delete{" "}
              <strong>{deletingPermission.name}</strong>?
              This action cannot be undone.
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDeletingPermission(null)}
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