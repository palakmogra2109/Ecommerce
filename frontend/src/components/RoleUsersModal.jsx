import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Avatar from "./Avatar";
import Pagination from "./Pagination";
import { listUsersByRole } from "../services/roles";
import { formatDate } from "../utils/format";

const COLUMNS = [
  { label: "User", sortKey: "name" },
  { label: "Mobile", sortKey: "mobile" },
  { label: "Status", sortKey: "status" },
  { label: "Created", sortKey: "created_at" },
];

export default function RoleUsersModal({ role, onClose }) {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    let active = true;

    setLoading(true);

    const run = async () => {
      try {
        const result = await listUsersByRole(role.uuid ?? role.id, {
          search,
          page,
          limit,
        });

        if (!active) {
          return;
        }

        if (result.success) {
          setUsers(result.users || []);
          if (result.pagination) {
            setPagination(result.pagination);
          }
        } else {
          setMessage(result.message);
        }
      } catch {
        if (active) {
          setMessage(
            "Unable to connect to the server. Please try again."
          );
        }
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
  }, [role.uuid, role.id, search, page, limit]);

  const rows = useMemo(() => {
    const data = [...users];

    if (sortKey) {
      data.sort((a, b) => {
        let aVal = a[sortKey];
        let bVal = b[sortKey];

        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return sortDir === "asc" ? -1 : 1;
        if (bVal == null) return sortDir === "asc" ? 1 : -1;

        if (typeof aVal === "string") {
          const cmp = aVal.localeCompare(bVal);
          return sortDir === "asc" ? cmp : -cmp;
        }

        if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
        if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
    }

    return data;
  }, [users, sortKey, sortDir]);

  function handleSort(label) {
    if (sortKey === label) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(label);
      setSortDir("asc");
    }
  }

  return (
    <div className="filament-modal-overlay" onClick={onClose}>
      <div className="filament-modal filament-modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="filament-modal-header">
          <div>
            <h2>Users in {role.name}</h2>
            <p className="filament-modal-sub">{pagination.total} user(s)</p>
          </div>
          <div className="filament-modal-tools">
            <div className="filament-search">
              <svg className="filament-search-icon" viewBox="0 0 24 24">
                <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
              </svg>
              <input
                type="text"
                placeholder="Search users..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="filament-modal-close"
              onClick={onClose}
              aria-label="Close"
            >
              &times;
            </button>
          </div>
        </div>

        {message ? (
          <div className="filament-empty">{message}</div>
        ) : (
          <div className="filament-modal-body">
            <div className="filament-table-wrap">
              <table className="filament-table">
                <thead>
                  <tr>
                    {COLUMNS.map((col) => (
                      <th
                        key={col.label}
                        className={col.sortKey ? "filament-th-sortable" : ""}
                        onClick={() => handleSort(col.sortKey)}
                      >
                        <span className="filament-th-content">
                          {col.label}
                          {col.sortKey && (
                            <span className="filament-sort-icon">
                              {sortKey === col.sortKey ? (
                                sortDir === "asc" ? (
                                  <svg viewBox="0 0 24 24">
                                    <path d="M7 14l5-5 5 5z" />
                                  </svg>
                                ) : (
                                  <svg viewBox="0 0 24 24">
                                    <path d="M7 10l5 5 5-5z" />
                                  </svg>
                                )
                              ) : (
                                <svg viewBox="0 0 24 24" className="filament-sort-idle">
                                  <path d="M7 10l5 5 5-5z" />
                                </svg>
                              )}
                            </span>
                          )}
                        </span>
                      </th>
                    ))}
                    <th className="filament-th-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={COLUMNS.length + 1} className="filament-empty">
                        <div className="filament-spinner" />
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={COLUMNS.length + 1} className="filament-empty">
                        No users found.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={row.uuid}>
                        <td>
                          <div className="user-cell">
                            <Avatar user={row} size={36} />
                            <div className="user-cell-text">
                              <Link to={`/users/${row.uuid}`}>
                                {row.name || "—"}
                              </Link>
                              <span>{row.email}</span>
                            </div>
                          </div>
                        </td>
                        <td>{row.mobile || "—"}</td>
                        <td>
                          <span className={`filament-badge filament-badge-${(row.status || "").toLowerCase()}`}>
                            <span className="filament-badge-dot" />
                            {row.status}
                          </span>
                        </td>
                        <td>{formatDate(row.created_at)}</td>
                        <td>
                          <div className="filament-actions">
                            <Link
                              className="filament-action-btn"
                              title="View"
                              to={`/users/${row.uuid}`}
                            >
                              <svg viewBox="0 0 24 24">
                                <path d="M12 4.5C7 4.5 2.7 8.1 1.5 12c1.2 3.9 5.5 7.5 10.5 7.5s9.3-3.6 10.5-7.5C21.3 8.1 17 4.5 12 4.5Zm0 12a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
                              </svg>
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              pagination={pagination}
              pageSizeOptions={[5, 10, 20, 50]}
              onPageChange={(nextPage) => setPage(nextPage)}
              onLimitChange={(nextLimit) => {
                setLimit(nextLimit);
                setPage(1);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}