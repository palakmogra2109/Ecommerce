import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Breadcrumb from "./Breadcrumb";
import Pagination from "./Pagination";
import { STATUS } from "@shared/constants";

// Reusable Filament-style data-list page.
//
// Props
//   title            string
//   breadcrumb       array [{ label, to }]
//   searchPlaceholder string
//   filters          array [{ key, label, options:[{value,label}] }]
//   fetchData        fn async ({ search, filters, page, limit }) => { success, <dataKey>: rows, pagination? }
//   dataKey          string
//   getKey           fn row => id
//   columns          array [{ label, render(row), type:'status', sortable?, sortKey?, searchable? }]
//   onStatusToggle   fn
//   actions          array
//   bulkActions      array
//   createLabel      string
//   onCreate         fn
//   defaultLimit     number
//   pageSizeOptions  array
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
  defaultLimit = 20,
  pageSizeOptions = [10, 20, 50, 100],
}) {
  const [rawData, setRawData] = useState([]);
  const [search, setSearch] = useState("");
  const [filterState, setFilterState] = useState({});
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingRow, setDeletingRow] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: defaultLimit,
    total: 0,
    totalPages: 1,
  });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(defaultLimit);

  // Sorting
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  // Column visibility
  const [hiddenCols, setHiddenCols] = useState([]);
  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef(null);

  const fetchDataRef = useRef(fetchData);
  fetchDataRef.current = fetchData;
  const getKeyRef = useRef(getKey);
  getKeyRef.current = getKey;

  // Reset to first page whenever search or filters change
  useEffect(() => {
    setPage(1);
  }, [search, filterState]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const result = await fetchDataRef.current({
          search,
          filters: filterState,
          page,
          limit,
        });

        if (!active) {
          return;
        }

        if (result.success) {
          setRawData(result[dataKey] || []);
          if (result.pagination) {
            setPagination(result.pagination);
          }
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
  }, [search, filterState, refreshKey, dataKey, page, limit]);

  // Close column picker on outside click
  useEffect(() => {
    function handleClick(e) {
      if (
        colPickerRef.current &&
        !colPickerRef.current.contains(e.target)
      ) {
        setShowColPicker(false);
      }
    }

    document.addEventListener("mousedown", handleClick);

    return () =>
      document.removeEventListener("mousedown", handleClick);
  }, []);

  // Client-side sort + search filter
  const data = useMemo(() => {
    let rows = [...rawData];

    // Global search across all searchable columns
    if (search.trim()) {
      const q = search.toLowerCase().trim();

      rows = rows.filter((row) => {
        return columns.some((col) => {
          if (col.searchable === false) {
            return false;
          }

          if (col.type === "status") {
            return (row.status || "")
              .toLowerCase()
              .includes(q);
          }

          const keys = col.searchKeys || [];

          if (col.sortKey) {
            keys.push(col.sortKey);
          }

          return keys.some((key) =>
            String(row[key] || "").toLowerCase().includes(q)
          );
        });
      });
    }

    // Sort
    if (sortKey) {
      const col = columns.find((c) => c.sortKey === sortKey);

      rows.sort((a, b) => {
        let aVal, bVal;

        if (col && col.sortKey) {
          aVal = a[col.sortKey];
          bVal = b[col.sortKey];
        } else {
          return 0;
        }

        if (aVal == null && bVal == null) {
          return 0;
        }

        if (aVal == null) {
          return sortDir === "asc" ? -1 : 1;
        }

        if (bVal == null) {
          return sortDir === "asc" ? 1 : -1;
        }

        if (typeof aVal === "string") {
          const cmp = aVal.localeCompare(bVal);

          return sortDir === "asc" ? cmp : -cmp;
        }

        if (aVal < bVal) {
          return sortDir === "asc" ? -1 : 1;
        }

        if (aVal > bVal) {
          return sortDir === "asc" ? 1 : -1;
        }

        return 0;
      });
    }

    return rows;
  }, [rawData, search, sortKey, sortDir, columns]);

  function handleSort(col) {
    if (!col.sortKey) {
      return;
    }

    if (sortKey === col.sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.sortKey);
      setSortDir("asc");
    }
  }

  function toggleSelect(id) {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((item) => item !== id)
        : [...prev, id]
    );
  }

  function toggleSelectAll() {
    const ids = data.map((row) => getKeyRef.current(row));
    const allSelected =
      ids.length > 0 && ids.every((id) => selected.includes(id));
    setSelected(allSelected ? [] : ids);
  }

  function toggleColumn(key) {
    setHiddenCols((prev) =>
      prev.includes(key)
        ? prev.filter((k) => k !== key)
        : [...prev, key]
    );
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
        setMessage(result.message || "Done");
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
        setMessage(result.message || "Deleted successfully");
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
    data.length > 0 &&
    data.every((row) => selected.includes(getKey(row)));

  const visibleColumns = columns.filter(
    (col) => !hiddenCols.includes(col.label)
  );

  return (
    <div className="filament-page">
      {breadcrumb && <Breadcrumb items={breadcrumb} />}

      {message && (
        <div className="filament-alert">{message}</div>
      )}

      <div className="filament-card">
        {/* Header */}
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>{title}</h1>
          </div>
          <div className="filament-card-header-center">
            <div className="filament-search">
              <svg
                className="filament-search-icon"
                viewBox="0 0 24 24"
              >
                <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
              </svg>
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {bulkActions.length > 0 && (
              <div className="filament-bulk">
                {bulkActions.map((action) => {
                  const disabled = busy || selected.length === 0;

                  return (
                    <button
                      key={action.label}
                      type="button"
                      className="filament-btn filament-btn-outline"
                      disabled={disabled}
                      onClick={() => handleBulk(action)}
                    >
                      {action.label}
                      {selected.length > 0 ? ` (${selected.length})` : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="filament-card-header-right">
            {onCreate && (
              <button
                type="button"
                className="filament-btn filament-btn-primary"
                onClick={onCreate}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="filament-btn-icon"
                >
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                </svg>
                {createLabel}
              </button>
            )}
          </div>
        </div>

        {/* Filters bar */}
        <div className="filament-card-filters">
          {filters.map((filter) => {
            const options = filter.options || [];

            return (
              <select
                key={filter.key}
                className="filament-select"
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
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            );
          })}

          {/* Column visibility toggle */}
          <div className="filament-col-picker" ref={colPickerRef}>
            <button
              type="button"
              className="filament-btn filament-btn-outline filament-col-toggle-btn"
              onClick={() => setShowColPicker((v) => !v)}
              title="Toggle columns"
            >
              <svg viewBox="0 0 24 24" className="filament-btn-icon">
                <path d="M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zm-6 18h2v-2h-2v2zm-8-8h2v-2H3v2zm0 4h2v-2H3v2zm0 4c0 1.1.9 2 2 2v-2H3zm8-16h2V3h-2v2zm8 8h2v-2h-2v2zm0-4h2V7h-2v2zm0 8h2v-2h-2v2zm0 4c1.1 0 2-.9 2-2h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z" />
              </svg>
            </button>
            {showColPicker && (
              <div className="filament-col-dropdown">
                {columns.map((col) => (
                  <label
                    key={col.label}
                    className="filament-col-option"
                  >
                    <input
                      type="checkbox"
                      checked={!hiddenCols.includes(col.label)}
                      onChange={() => toggleColumn(col.label)}
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="filament-table-wrap">
          <table className="filament-table">
            <thead>
              <tr>
                <th className="filament-th-check">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                  />
                </th>
                {visibleColumns.map((column) => (
                  <th
                    key={column.label}
                    className={
                      column.sortKey
                        ? "filament-th-sortable"
                        : ""
                    }
                    onClick={() => handleSort(column)}
                  >
                    <span className="filament-th-content">
                      {column.label}
                      {column.sortKey && (
                        <span className="filament-sort-icon">
                          {sortKey === column.sortKey ? (
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
                <th className="filament-th-actions">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length + 2}
                    className="filament-empty"
                  >
                    <div className="filament-spinner" />
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length + 2}
                    className="filament-empty"
                  >
                    No {title.toLowerCase()} found.
                  </td>
                </tr>
              ) : (
                data.map((row) => {
                  const id = getKey(row);

                  return (
                    <tr
                      key={id}
                      className={
                        selected.includes(id)
                          ? "row-selected"
                          : ""
                      }
                    >
                      <td className="filament-td-check">
                        <input
                          type="checkbox"
                          checked={selected.includes(id)}
                          onChange={() => toggleSelect(id)}
                        />
                      </td>

                      {visibleColumns.map((column) => (
                        <td key={column.label}>
                          {column.type === "status" ? (
                            <div className="filament-status">
                              <span
                                className={`filament-badge filament-badge-${(row.status || "").toLowerCase()}`}
                              >
                                <span className="filament-badge-dot" />
                                {row.status}
                              </span>
                              {onStatusToggle && (
                                <button
                                  type="button"
                                  className={`filament-toggle ${row.status === STATUS.ACTIVE ? "filament-toggle-on" : ""}`}
                                  title={
                                    row.status === STATUS.ACTIVE
                                      ? "Deactivate"
                                      : "Activate"
                                  }
                                  onClick={() =>
                                    handleToggleStatus(row)
                                  }
                                >
                                  <span className="filament-toggle-knob" />
                                </button>
                              )}
                            </div>
                          ) : (
                            column.render(row)
                          )}
                        </td>
                      ))}

                      <td>
                        <div className="filament-actions">
                          {actions.map((action) => {
                            if (action.type === "delete") {
                              return (
                                <button
                                  key={action.type}
                                  type="button"
                                  className="filament-action-btn filament-action-danger"
                                  title={
                                    action.tooltip ?? "Delete"
                                  }
                                  disabled={action.disabled?.(
                                    row
                                  )}
                                  onClick={() =>
                                    requestDelete(row)
                                  }
                                >
                                  <svg viewBox="0 0 24 24">
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
                                className="filament-action-btn"
                                title={action.tooltip}
                                to={to}
                              >
                                <svg viewBox="0 0 24 24">
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

        <Pagination
          pagination={pagination}
          pageSizeOptions={pageSizeOptions}
          onPageChange={(nextPage) => setPage(nextPage)}
          onLimitChange={(nextLimit) => {
            setLimit(nextLimit);
            setPage(1);
          }}
        />
      </div>

      {/* Delete modal */}
      {deletingRow && (
        <div
          className="filament-modal-overlay"
          onClick={() => setDeletingRow(null)}
        >
          <div
            className="filament-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="filament-modal-header">
              <h2>Delete {title.slice(0, -1)}</h2>
              <button
                type="button"
                className="filament-modal-close"
                onClick={() => setDeletingRow(null)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div className="filament-modal-body">
              <p>
                Are you sure you want to delete{" "}
                <strong>
                  {deletingRow.name || deletingRow.email}
                </strong>
                ? This action cannot be undone.
              </p>
            </div>
            <div className="filament-modal-footer">
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={() => setDeletingRow(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="filament-btn filament-btn-danger"
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