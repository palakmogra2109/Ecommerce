import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Breadcrumb from "./Breadcrumb";

// Reusable data-list page.
//
// Props
//   title           string  page heading
//   breadcrumb      array   [{ label, to }] for the breadcrumb
//   searchPlaceholder string
//   filters         array   [{ key, label, options:[{value,label}] }]
//   fetchData       fn      async ({ search, filters }) => { success, <dataKey>: rows }
//   dataKey         string  key that holds the rows in the response
//   getKey          fn      row => id (default row.id)
//   columns         array   [{ label, key?, render(row), type:'status' }]
//   onStatusToggle  fn      row => next status persisted (enables the status switch)
//   actions         array   [{ type:'view'|'edit'|'delete', tooltip, to(row), onDelete(row) }]
//   bulkActions     array   [{ label, run(ids) => {message} }]
//   createLabel     string  button text (renders header action)
//   onCreate        fn      navigate to create page
export default function DataPage({
  title,
  breadcrumb,
  searchPlaceholder = "Search...",
  filters = [],
  fetchData,
  dataKey = "data",
  getKey = (row) => row.id,
  columns = [],
  onStatusToggle = null,
  actions = [],
  bulkActions = [],
  createLabel = "Add",
  onCreate = null,
}) {
  const [data, setData] = useState([]);
  const [search, setSearch] = useState("");
  const [filterState, setFilterState] = useState({});
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingRow, setDeletingRow] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const result = await fetchData({ search, filters: filterState });

        if (!active) {
          return;
        }

        if (result.success) {
          setData(result[dataKey] || []);
          setSelected([]);
        } else {
          setMessage(result.message);
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
  }, [search, filterState, refreshKey, fetchData, dataKey]);

  function toggleSelect(id) {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((item) => item !== id)
        : [...prev, id]
    );
  }

  function toggleSelectAll() {
    const ids = data.map(getKey);

    const allSelected =
      ids.length > 0 && ids.every((id) => selected.includes(id));

    setSelected(allSelected ? [] : ids);
  }

  async function handleToggleStatus(row) {
    if (!onStatusToggle) {
      return;
    }

    try {
      const result = await onStatusToggle(row);

      if (result && result.success) {
        setMessage(result.message);
      } else if (result && result.message) {
        setMessage(result.message);
      }
    } catch {
      setMessage(
        "Unable to connect to the server. Please try again."
      );
    } finally {
      setRefreshKey((k) => k + 1);
    }
  }

  async function handleBulk(action) {
    if (selected.length === 0) {
      setMessage("Select at least one item");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const result = await action.run(selected);

      if (result) {
        setMessage(
          result.message || "Done"
        );
      }
    } catch {
      setMessage(
        "Unable to connect to the server. Please try again."
      );
    } finally {
      setBusy(false);
      setRefreshKey((k) => k + 1);
    }
  }

  function requestDelete(row) {
    const action = actions.find((a) => a.type === "delete");

    if (action) {
      setDeletingRow(row);
    }
  }

  async function confirmDelete() {
    if (!deletingRow) {
      return;
    }

    const action = actions.find((a) => a.type === "delete");

    if (!action) {
      setDeletingRow(null);
      return;
    }

    try {
      const result = await action.onDelete(deletingRow);

      if (result) {
        setMessage(
          result.message ||
            "Deleted successfully"
        );
      }
    } catch {
      setMessage(
        "Unable to connect to the server. Please try again."
      );
    } finally {
      setDeletingRow(null);
      setRefreshKey((k) => k + 1);
    }
  }

  const allSelected =
    data.length > 0 && data.every((row) => selected.includes(getKey(row)));

  return (
    <div className="admin-page">
      {breadcrumb && <Breadcrumb items={breadcrumb} />}

      <div className="admin-header">
        <h1>{title}</h1>
        {onCreate && (
          <button type="button" onClick={onCreate}>
            {createLabel}
          </button>
        )}
      </div>

      {message && <p className="form-message">{message}</p>}

      <div className="list-toolbar">
        <div className="bulk-actions">
          {bulkActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="btn-secondary btn-sm"
              disabled={busy || selected.length === 0}
              onClick={() => handleBulk(action)}
            >
              {action.label} ({selected.length})
            </button>
          ))}
        </div>

        <div className="list-filters">
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {filters.map((filter) => {
            const options = filter.options || [];

            return (
              <select
                key={filter.key}
                value={filterState[filter.key] ?? ""}
                onChange={(e) =>
                  setFilterState((prev) => ({
                    ...prev,
                    [filter.key]: e.target.value,
                  }))
                }
              >
                <option value="">{filter.label}</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            );
          })}
        </div>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th className="check-col">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                />
              </th>
              {columns.map((column) => (
                <th key={column.label}>{column.label}</th>
              ))}
              <th className="actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length + 2}
                  className="admin-empty"
                >
                  Loading...
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 2}
                  className="admin-empty"
                >
                  No {title.toLowerCase()} found
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const id = getKey(row);

                return (
                  <tr
                    key={id}
                    className={
                      selected.includes(id) ? "row-selected" : ""
                    }
                  >
                    <td className="check-col">
                      <input
                        type="checkbox"
                        checked={selected.includes(id)}
                        onChange={() => toggleSelect(id)}
                      />
                    </td>

                    {columns.map((column) => (
                      <td key={column.label}>
                        {column.type === "status" ? (
                          <div className="status-cell">
                            <span
                              className={`status-badge status-${(row.status || "").toLowerCase()}`}
                            >
                              {row.status}
                            </span>
                            {onStatusToggle && (
                              <label
                                className="switch"
                                data-tooltip={
                                  row.status === "ACTIVE"
                                    ? "Deactivate"
                                    : "Activate"
                                }
                              >
                                <input
                                  type="checkbox"
                                  checked={row.status === "ACTIVE"}
                                  onChange={() => handleToggleStatus(row)}
                                />
                                <span className="slider" />
                              </label>
                            )}
                          </div>
                        ) : (
                          column.render(row)
                        )}
                      </td>
                    ))}

                    <td>
                      <div className="row-actions">
                        {actions.map((action) => {
                          if (action.type === "delete") {
                            return (
                              <button
                                key={action.type}
                                type="button"
                                className="icon-btn icon-btn-danger"
                                data-tooltip={action.tooltip ?? "Delete"}
                                disabled={action.disabled?.(row)}
                                onClick={() => requestDelete(row)}
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM8 9h8v10H8V9Zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5Z" />
                                </svg>
                              </button>
                            );
                          }

                          const to = action.to?.(row);

                          const svg =
                            action.type === "view" ? (
                              <path d="M12 4.5C7 4.5 2.7 8.1 1.5 12c1.2 3.9 5.5 7.5 10.5 7.5s9.3-3.6 10.5-7.5C21.3 8.1 17 4.5 12 4.5Zm0 12a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
                            ) : (
                              <path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25Zm16.93-9.6a1 1 0 0 0 0-1.41L18.76 4.2a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.66-1.66Z" />
                            );

                          return (
                            <Link
                              key={action.type}
                              className="icon-btn"
                              data-tooltip={action.tooltip}
                              to={to}
                              onClick={action.onClick?.(row)}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                {svg}
                              </svg>
                            </Link>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {deletingRow && (
        <div
          className="modal-overlay"
          onClick={() => setDeletingRow(null)}
        >
          <div
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Delete {title.slice(0, -1)}</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setDeletingRow(null)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <p className="confirm-text">
              Are you sure you want to delete{" "}
              <strong>{deletingRow.name || deletingRow.email}</strong>?
              This action cannot be undone.
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDeletingRow(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={confirmDelete}
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