import { useState } from "react";
import { retireSupplier, restoreSupplier } from "../services/purchases";

// Active / Inactive control for a supplier.
//
// This is a soft delete, not a removal: purchase invoices reference suppliers, so
// an audit trail that vanished with the row would not be an audit trail. Which is
// why it is an explicit, labelled control rather than a trash icon in a row menu
// -- flipping a supplier's status should be a deliberate act, and it is
// reversible from the same place.

export default function SupplierStatusControl({ supplier, onChanged, size = "" }) {
  const [busy, setBusy] = useState(false);
  const active = supplier.is_active;

  const set = async (next, message) => {
    setBusy(true);
    try {
      if (next) await restoreSupplier(supplier.uuid);
      else await retireSupplier(supplier.uuid);
      await onChanged?.(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`sp-status${size ? ` sp-status-${size}` : ""}`}>
      <span className="sp-status-label">Status</span>
      <span className={`sp-status-pill ${active ? "is-active" : "is-inactive"}`}>
        <span className="sp-status-dot" aria-hidden="true" />
        {active ? "Active" : "Inactive"}
      </span>
      <button
        type="button"
        className={`filament-btn ${active ? "filament-btn-danger" : "filament-btn-primary"}${size ? " filament-btn-small" : ""}`}
        disabled={busy}
        onClick={() => set(!active, active ? `${supplier.name} set to inactive` : `${supplier.name} reactivated`)}
      >
        {busy ? "Saving…" : active ? "Set inactive" : "Set active"}
      </button>
      {!active && (
        <small className="frm-hint">
          Inactive suppliers keep their invoices and can be reactivated at any time.
        </small>
      )}
    </div>
  );
}
