import { useEffect, useState } from "react";
import {
  listUsers,
  updateUser,
  deleteUser,
} from "../services/users";
import UserForm from "../components/UserForm";

const STATUS_CYCLE = {
  ACTIVE: "INACTIVE",
  INACTIVE: "SUSPENDED",
  SUSPENDED: "ACTIVE",
};

export default function Users() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [deletingUser, setDeletingUser] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const data = await listUsers({
          search,
          status,
        });

        if (!active) {
          return;
        }

        if (data.success) {
          setUsers(data.users);
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
  }, [search, status, refreshKey]);

  function openCreate() {
    setEditingUser(null);
    setFormOpen(true);
  }

  function openEdit(user) {
    setEditingUser(user);
    setFormOpen(true);
  }

  async function handleToggleStatus(user) {
    const nextStatus = STATUS_CYCLE[user.status] || "ACTIVE";

    try {
      const data = await updateUser(user.id, {
        status: nextStatus,
      });

      if (data.success) {
        setMessage(`User status updated to ${nextStatus}`);
      } else {
        setMessage(data.message);
      }
    } catch {
      setMessage(
        "Unable to connect to the server. Please try again."
      );
    } finally {
      setRefreshKey((k) => k + 1);
    }
  }

  async function handleDelete() {
    if (!deletingUser) {
      return;
    }

    try {
      const data = await deleteUser(deletingUser.id);

      if (data.success) {
        setMessage(`User ${deletingUser.email} deleted`);
      } else {
        setMessage(data.message);
      }
    } catch {
      setMessage(
        "Unable to connect to the server. Please try again."
      );
    } finally {
      setDeletingUser(null);
      setRefreshKey((k) => k + 1);
    }
  }

  function handleSaved(m) {
    setMessage(m);
    setFormOpen(false);
    setEditingUser(null);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Users</h1>
        <button type="button" onClick={openCreate}>
          Add User
        </button>
      </div>

      {message && (
        <p className="form-message">{message}</p>
      )}

      <div className="admin-filters">
        <input
          type="text"
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="6" className="admin-empty">
                  Loading...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan="6" className="admin-empty">
                  No users found
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id}>
                  <td>{user.id}</td>
                  <td>{user.name || "-"}</td>
                  <td>{user.email}</td>
                  <td>
                    <span
                      className={`status-badge status-${user.status.toLowerCase()}`}
                    >
                      {user.status}
                    </span>
                  </td>
                  <td>
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => openEdit(user)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => handleToggleStatus(user)}
                      >
                        Toggle
                      </button>
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        onClick={() => setDeletingUser(user)}
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
        <UserForm
          user={editingUser}
          onClose={() => setFormOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {deletingUser && (
        <div
          className="modal-overlay"
          onClick={() => setDeletingUser(null)}
        >
          <div
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Delete User</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setDeletingUser(null)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <p className="confirm-text">
              Are you sure you want to delete{" "}
              <strong>{deletingUser.email}</strong>? This
              action cannot be undone.
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDeletingUser(null)}
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