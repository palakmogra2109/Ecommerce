import { useMemo, useState } from "react";

import {
  MODULE_LABELS,
  MODULE_DESCRIPTIONS,
  MODULE_SLUGS,
} from "@shared/constants";

// Modules never shown in the permission matrix.
const HIDDEN_MODULES = ["permissions"];

// Preferred display order for common action types; anything else sorts
// alphabetically after these.
const COLUMN_ORDER = [
  "view",
  "read",
  "create",
  "add",
  "update",
  "edit",
  "delete",
  "remove",
  "assign",
  "manage",
  "approve",
  "reject",
  "publish",
  "unpublish",
  "draft",
  "export",
  "import",
  "duplicate",
];

// Known action colors; unknown actions get a color from the fallback palette.
const ACTION_COLORS = {
  view: "#10b981",
  read: "#10b981",
  create: "#3b82f6",
  add: "#3b82f6",
  update: "#f59e0b",
  edit: "#f59e0b",
  delete: "#ef4444",
  remove: "#ef4444",
  assign: "#8b5cf6",
  manage: "#6366f1",
  approve: "#14b8a6",
  reject: "#f43f5e",
  publish: "#ec4899",
  unpublish: "#a855f7",
  draft: "#eab308",
  export: "#64748b",
  import: "#0ea5e9",
  duplicate: "#22d3ee",
};

const FALLBACK_COLORS = ["#0ea5e9", "#ec4899", "#a855f7", "#f97316", "#84cc16", "#06b6d4", "#d946ef", "#14b8a6"];

// Extract the action part of a `module.action` slug.
// Permissions without a dotted slug are grouped under "general".
function actionFromPermission(slug) {
  if (!slug) return "general";
  const dot = slug.indexOf(".");
  return dot > 0 ? slug.slice(dot + 1).trim() : "general";
}

function humanizeAction(action) {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

function actionColor(action) {
  if (ACTION_COLORS[action]) return ACTION_COLORS[action];
  let hash = 0;
  for (let i = 0; i < action.length; i++) {
    hash = (hash * 31 + action.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

function sortColumns(columns) {
  return [...columns].sort((a, b) => {
    const ia = COLUMN_ORDER.indexOf(a);
    const ib = COLUMN_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

function permissionKey(p) {
  return p.uuid ?? p.slug ?? String(p.id);
}

function formatModule(module) {
  return (
    MODULE_LABELS[module] ||
    (module || "Other")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function moduleDescription(module) {
  return (
    MODULE_DESCRIPTIONS[module] ||
    `Manage ${formatModule(module).toLowerCase()} within the panel.`
  );
}

// ── Toggle switch component ────────────────────────────────────
function PermToggle({ checked, onChange, disabled, label, locked, hint }) {
  return (
    <label
      className={`perm-toggle${disabled ? " perm-toggle-disabled" : ""}${locked ? " perm-toggle-locked" : ""}`}
      title={locked ? `${label}\n\nView is required when other permissions in this module are selected` : hint || label}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled || locked}
        aria-label={label}
      />
      <span className="perm-toggle-track">
        <span className="perm-toggle-knob" />
      </span>
    </label>
  );
}

// ── Module icon SVGs ──────────────────────────────────────────
const MODULE_ICONS = {
  users:
    "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
  roles:
    "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  permissions:
    "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z",
  dashboard:
    "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
  products:
    "M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z",
  orders:
    "M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z",
  email_templates:
    "M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z",
  settings:
    "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
};

function ModuleIcon({ module }) {
  const path = MODULE_ICONS[module];
  if (!path) {
    return (
      <span className="perm-mod-icon perm-mod-icon-fallback">
        {formatModule(module).charAt(0)}
      </span>
    );
  }
  return (
    <svg className="perm-mod-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────
export default function PermissionPicker({
  permissions = [],
  selected = [],
  onChange,
  disabled = false,
}) {
  const [filter, setFilter] = useState("");

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Build a lookup: { [module]: { [action]: permission } }
  const matrix = useMemo(() => {
    const m = {};

    for (const p of permissions) {
      const mod = p.module || "other";
      const action = actionFromPermission(p.slug);

      if (!action) continue;
      if (HIDDEN_MODULES.includes(mod)) continue;

      if (!m[mod]) m[mod] = {};
      m[mod][action] = p;
    }

    return m;
  }, [permissions]);

  // Modules in a stable order: seed order first, then alphabetically
  const modules = useMemo(() => {
    const known = MODULE_SLUGS.filter((slug) => matrix[slug]);
    const unknown = Object.keys(matrix)
      .filter((slug) => !MODULE_SLUGS.includes(slug))
      .sort();
    return [...known, ...unknown];
  }, [matrix]);

  // Filter modules by search
  const visibleModules = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return modules;
    return modules.filter((mod) => {
      if (formatModule(mod).toLowerCase().includes(q)) return true;
      const actions = matrix[mod] || {};
      return Object.values(actions).some(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q)
      );
    });
  }, [modules, matrix, filter]);

  // Which actions actually exist in the dataset
  const activeColumns = useMemo(() => {
    const present = new Set();
    for (const mod of modules) {
      for (const action of Object.keys(matrix[mod] || {})) {
        present.add(action);
      }
    }
    return sortColumns([...present]);
  }, [modules, matrix]);

  // Global totals
  const allPerms = useMemo(
    () =>
      permissions.filter(
        (p) => actionFromPermission(p.slug) && !HIDDEN_MODULES.includes(p.module)
      ),
    [permissions]
  );
  const totalGranted = allPerms.filter((p) => selectedSet.has(permissionKey(p))).length;

  function togglePermission(p) {
    if (disabled) return;
    const key = permissionKey(p);
    const isSelected = selectedSet.has(key);
    const next = isSelected
      ? selected.filter((id) => id !== key)
      : [...selected, key];
    onChange(next);
  }

  function toggleModuleAll(mod) {
    if (disabled) return;
    const perms = Object.values(matrix[mod] || {});
    const keys = perms.map(permissionKey);
    const allOn = keys.every((k) => selectedSet.has(k));
    onChange(
      allOn
        ? selected.filter((id) => !keys.includes(id))
        : [...new Set([...selected, ...keys])]
    );
  }

  function toggleActionColumn(action) {
    if (disabled) return;
    const keys = [];
    for (const mod of modules) {
      const p = matrix[mod]?.[action];
      if (p) keys.push(permissionKey(p));
    }
    const allOn = keys.every((k) => selectedSet.has(k));
    onChange(
      allOn
        ? selected.filter((id) => !keys.includes(id))
        : [...new Set([...selected, ...keys])]
    );
  }

  function selectAll() {
    if (disabled) return;
    onChange(allPerms.map(permissionKey));
  }

  function selectNone() {
    if (disabled) return;
    onChange([]);
  }

  function isViewLocked(mod) {
    if (disabled) return false;
    const viewP = matrix[mod]?.view;
    if (!viewP) return false;
    const viewKey = permissionKey(viewP);
    return Object.values(matrix[mod] || {}).some(
      (p) => permissionKey(p) !== viewKey && selectedSet.has(permissionKey(p))
    );
  }

  return (
    <div className="perm-matrix-wrapper">
      {/* Toolbar */}
      <div className="perm-matrix-toolbar">
        <div className="perm-matrix-search">
          <svg className="perm-matrix-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <input
            type="text"
            className="perm-matrix-search-input"
            placeholder="Search modules or permissions..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={disabled}
            aria-label="Search permissions"
          />
        </div>
        <div className="perm-matrix-actions">
          <button type="button" className="filament-btn filament-btn-outline" onClick={selectAll} disabled={disabled}>
            Select all
          </button>
          <button type="button" className="filament-btn filament-btn-outline" onClick={selectNone} disabled={disabled}>
            Clear all
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="perm-matrix-summary" aria-live="polite">
        <span className="perm-matrix-summary-count">
          <strong>{totalGranted}</strong> of {allPerms.length} permissions granted
        </span>
        {allPerms.length > 0 && (
          <div className="perm-matrix-summary-bar">
            <div
              className="perm-matrix-summary-bar-fill"
              style={{ width: `${Math.round((totalGranted / allPerms.length) * 100)}%` }}
            />
          </div>
        )}
        {allPerms.length > 0 && (
          <span className="perm-matrix-summary-pct">
            {Math.round((totalGranted / allPerms.length) * 100)}%
          </span>
        )}
      </div>

      {/* Matrix table */}
      {visibleModules.length === 0 ? (
        <p className="filament-empty">
          No permissions available. Create some permissions first.
        </p>
      ) : (
        <div className="perm-matrix-scroll">
          <table className="perm-matrix" role="grid" aria-label="Permission matrix">
            <thead>
              <tr>
                <th className="perm-matrix-th perm-matrix-th-module">
                  <span>Module</span>
                </th>
                {activeColumns.map((action) => {
                  const total = modules.filter((m) => matrix[m]?.[action]).length;
                  const granted = modules.filter(
                    (m) => matrix[m]?.[action] && selectedSet.has(permissionKey(matrix[m][action]))
                  ).length;
                  const allOn = total > 0 && granted === total;

                  return (
                    <th key={action} className="perm-matrix-th" style={{ "--col-color": actionColor(action) }}>
                      <button
                        type="button"
                        className="perm-matrix-th-toggle"
                        onClick={() => toggleActionColumn(action)}
                        disabled={disabled || total === 0}
                        title={`Select all / none — ${humanizeAction(action)}`}
                      >
                        <span className="perm-matrix-th-label" style={{ color: actionColor(action) }}>
                          {humanizeAction(action)}
                        </span>
                        <span className={`perm-matrix-th-count${allOn ? " perm-matrix-th-count-full" : ""}`}>
                          {granted}/{total}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibleModules.map((mod) => {
                const actions = matrix[mod] || {};
                const modPerms = Object.values(actions);
                const modSelected = modPerms.filter((p) => selectedSet.has(permissionKey(p))).length;
                const locked = isViewLocked(mod);

                return (
                  <tr key={mod} className="perm-matrix-row">
                    <td className="perm-matrix-td perm-matrix-td-module">
                      <div className="perm-matrix-module">
                        <ModuleIcon module={mod} />
                        <div className="perm-matrix-module-text">
                          <span className="perm-matrix-module-name">{formatModule(mod)}</span>
                          <span className="perm-matrix-module-desc">{moduleDescription(mod)}</span>
                        </div>
                        <button
                          type="button"
                          className={`perm-matrix-row-total${modSelected === modPerms.length && modSelected > 0 ? " perm-matrix-row-total-full" : ""}`}
                          onClick={() => toggleModuleAll(mod)}
                          disabled={disabled}
                          title={`Select all / none — ${formatModule(mod)}`}
                        >
                          {modSelected}/{modPerms.length}
                        </button>
                      </div>
                    </td>
                    {activeColumns.map((action) => {
                      const p = actions[action];

                      if (!p) {
                        return (
                          <td key={action} className="perm-matrix-td perm-matrix-td-empty">
                            <span className="perm-matrix-dash">&mdash;</span>
                          </td>
                        );
                      }

                      return (
                        <td key={action} className="perm-matrix-td">
                          <PermToggle
                            checked={selectedSet.has(permissionKey(p))}
                            onChange={() => togglePermission(p)}
                            disabled={disabled}
                            locked={action === "view" && locked}
                            label={p.name}
                            hint={`${p.name}\n${p.slug}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="perm-matrix-legend">
        {activeColumns.map((action) => (
          <span key={action} className="perm-matrix-legend-item">
            <span className="perm-matrix-legend-dot" style={{ background: actionColor(action) }} />
            {humanizeAction(action)}
          </span>
        ))}
        {activeColumns.includes("view") && (
          <span className="perm-matrix-legend-item">
            <span className="perm-matrix-legend-dot" style={{ background: "#94a3b8" }} />
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9z" /></svg>
            View locked when sibling selected
          </span>
        )}
      </div>
    </div>
  );
}