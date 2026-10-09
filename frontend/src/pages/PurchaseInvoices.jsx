import { useEffect, useMemo, useState } from "react";
import DataPage from "../components/DataPage";
import Breadcrumb from "../components/Breadcrumb";
import { useNavigate } from "react-router-dom";
import { listPurchaseInvoices, createPurchaseInvoice, listSuppliers } from "../services/purchases";
import ProductPicker from "./ProductPicker";

// A line total, mirroring the server's arithmetic so the operator sees the figure
// that will be booked. The server recomputes regardless; this is a preview only.
export const rupees = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function Notice({ children }) {
  if (!children) return null;
  return <div className="filament-alert filament-alert-info">{children}</div>;
}

// Margin on a line, shown so a typo in the selling price is obvious before it
// is written to the product. Null while either side is missing.
const marginOf = (line) => {
  const sell = Number(line.sellingPrice);
  const cost = Number(line.unitCost);
  if (!(sell > 0) || !(cost >= 0) || !line.product) return null;
  return { amount: sell - cost, percent: cost > 0 ? ((sell - cost) / sell) * 100 : null };
};

const lineTotal = (line) => {
  const gross = (Number(line.unitCost) || 0) * (Number(line.quantityOrdered) || 0);
  const discount = (gross * (Number(line.discountPercent) || 0)) / 100;
  const taxable = gross - discount;
  const tax = (taxable * (Number(line.taxPercent) || 0)) / 100;
  return { gross, discount, tax, total: taxable + tax };
};

const STATUS_OPTIONS = [
  { value: "AWAITING_STOCK", label: "Awaiting stock" },
  { value: "PARTIALLY_RECEIVED", label: "Partially received" },
  { value: "RECEIVED", label: "Received" },
  { value: "CANCELLED", label: "Cancelled" },
];

// The methods the backend accepts for a supplier payment (see
// PurchaseInvoice.PAYMENT_METHODS). The backend validates this list too; this
// copy only decides what the dropdown offers.
const PAYMENT_METHODS = ["CASH", "BANK", "UPI", "CARD", "CHEQUE", "CREDIT_NOTE"];

const PAYMENT_OPTIONS = [
  { value: "UNPAID", label: "Unpaid" },
  { value: "PARTIALLY_PAID", label: "Part paid" },
  { value: "PAID", label: "Paid" },
];

// The list. A row links to /purchase-invoices/:uuid for the detail, matching the
// gift-card pages, because receiving and paying need a full page of their own.
export default function PurchaseInvoices() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <>
    <DataPage
      title="Purchase Invoices"
      breadcrumb={[{ label: "Dashboard", to: "/dashboard" }, { label: "Purchase Invoices" }]}
      searchPlaceholder="Search invoice number, supplier invoice, supplier…"
      filters={[
        { key: "status", label: "Status", options: STATUS_OPTIONS },
        { key: "paymentStatus", label: "Payment", options: PAYMENT_OPTIONS },
      ]}
      fetchData={async ({ search, filters, page, limit }) => {
        const data = await listPurchaseInvoices({
          search, status: filters?.status, paymentStatus: filters?.paymentStatus, page, limit,
        });
        return { success: data.success, invoices: data.invoices, pagination: data.pagination };
      }}
      dataKey="invoices"
      refreshToken={refreshToken}
      getKey={(row) => row.uuid}
      permissions={{
        view: "purchase_invoices.view",
        create: "purchase_invoices.create",
        update: "purchase_invoices.update",
        delete: "purchase_invoices.cancel",
      }}
      createLabel="New Purchase Invoice"
      onCreate={() => navigate("/purchase-invoices/new")}
      columns={[
        {
          label: "Invoice",
          render: (row) => (
            <>
              <strong>{row.invoice_number}</strong>
              <div className="filament-badge-dot" />
              <small>supplier ref {row.supplier_invoice_number}</small>
            </>
          ),
        },
        { label: "Supplier", render: (row) => row.supplier_name },
        {
          label: "Date",
          render: (row) => new Date(row.invoice_date).toLocaleDateString("en-IN"),
        },
        {
          label: "Total",
          render: (row) => (
            <div>
              <strong>{rupees(row.total_amount)}</strong>
              {Number(row.outstanding) !== 0 && (
                <small>{rupees(row.outstanding)} outstanding</small>
              )}
            </div>
          ),
        },
        { label: "Status", type: "status" },
        // Not type:"status": DataPage would render row.status again and the
        // Payment column would have repeated the Status column.
        { label: "Payment", render: (row) => row.payment_status },
      ]}
      actions={[
        {
          type: "view",
          permission: "purchase_invoices.view",
          tooltip: "Open purchase invoice",
          to: (row) => `/purchase-invoices/${row.uuid}`,
        },
      ]}
    />
    {creating && (
      <NewInvoiceModal
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          setRefreshToken((n) => n + 1);
        }}
      />
    )}
    </>
  );
}

// ── receiving ──────────────────────────────────────────────────────────────

export function ReceiveModal({ invoice, onClose, onSubmit, fullPage = false }) {
  // One row per invoice line, pre-filled with whatever is still outstanding.
  const [rows, setRows] = useState(
    invoice.items.map((item) => {
      const outstanding =
        Number(item.quantity_ordered) - Number(item.quantity_received) -
        Number(item.quantity_damaged) - Number(item.quantity_rejected);
      return {
        purchaseInvoiceItemId: item.id,
        label: item.name || item.sku,
        ordered: Number(item.quantity_ordered),
        already:
          Number(item.quantity_received) + Number(item.quantity_damaged) + Number(item.quantity_rejected),
        accepted: outstanding > 0 ? outstanding : 0,
        damaged: 0,
        missing: 0,
      };
    })
  );
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  const setField = (index, field, value) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, [field]: value } : row)));

  const lineTotalOf = (row) =>
    Number(row.accepted || 0) + Number(row.damaged || 0) + Number(row.missing || 0);
  const remaining = (row) => row.ordered - row.already;
  const overReceipt = rows.some((row) => lineTotalOf(row) > remaining(row));
  const nothingToRecord = rows.every((row) => lineTotalOf(row) === 0);

  const totals = rows.reduce(
    (acc, row) => ({
      accepted: acc.accepted + (Number(row.accepted) || 0),
      damaged: acc.damaged + (Number(row.damaged) || 0),
      missing: acc.missing + (Number(row.missing) || 0),
    }),
    { accepted: 0, damaged: 0, missing: 0 }
  );

  const adjust = (index, field, delta) =>
    setRows((current) =>
      current.map((row, i) => {
        if (i !== index) return row;
        const next = Math.max(0, Math.min(remaining(row), (Number(row[field]) || 0) + delta));
        return { ...row, [field]: next };
      })
    );

  const fillDue = () =>
    setRows((current) =>
      current.map((row) => ({ ...row, accepted: Math.max(0, remaining(row)) , damaged: 0, missing: 0 }))
    );

  const clearAll = () =>
    setRows((current) =>
      current.map((row) => ({ ...row, accepted: 0, damaged: 0, missing: 0 }))
    );

  const submit = async (event) => {
    event.preventDefault();
    if (overReceipt || nothingToRecord) return;
    setBusy(true);
    setLocalError("");
    try {
      await onSubmit(
        rows
          .filter((row) => lineTotalOf(row) > 0)
          .map((row) => ({
            purchaseInvoiceItemId: row.purchaseInvoiceItemId,
            accepted: Number(row.accepted || 0),
            damaged: Number(row.damaged || 0),
            missing: Number(row.missing || 0),
          })),
        notes || null
      );
    } catch (e) {
      setLocalError(e.message || "Unable to record this receipt.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="filament-modal-overlay" onClick={onClose}>
      <div className="filament-modal filament-modal-lg" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="filament-modal-header">
          <div>
            <h2>Receive stock</h2>
            <p className="filament-modal-sub">
              Only <strong>accepted</strong> becomes sellable stock. Damaged and missing are
              recorded against the invoice but do not enter the warehouse.
            </p>
          </div>
          {!fullPage && (
            <button type="button" className="filament-modal-close" onClick={onClose} aria-label="Close">×</button>
          )}
        </div>

        <form onSubmit={submit}>
          <div className="filament-modal-body">
            <div className="receive-summary">
              <div className="receive-summary-item">
                <span>Into stock</span>
                <strong className="receive-summary-ok">{totals.accepted}</strong>
              </div>
              <div className="receive-summary-item">
                <span>Damaged</span>
                <strong className="receive-summary-warn">{totals.damaged}</strong>
              </div>
              <div className="receive-summary-item">
                <span>Missing</span>
                <strong className="receive-summary-bad">{totals.missing}</strong>
              </div>
              <div className="receive-summary-item">
                <span>Recording</span>
                <strong>{totals.accepted + totals.damaged + totals.missing}</strong>
              </div>
            </div>

            {localError && <Notice>{localError}</Notice>}
            {overReceipt && <Notice>You cannot record more than the due quantity on a line.</Notice>}

            <table className="filament-table receive-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="receive-center">Due</th>
                  <th className="receive-center">Accepted</th>
                  <th className="receive-center">Damaged</th>
                  <th className="receive-center">Missing</th>
                  <th className="receive-center">Recording</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const recorded = lineTotalOf(row);
                  const due = remaining(row);
                  const rowOver = recorded > due;
                  const rowDone = recorded === due && due >= 0 && recorded > 0;

                  return (
                    <tr
                      key={row.purchaseInvoiceItemId}
                      className={rowOver ? "receive-row-over" : rowDone ? "receive-row-done" : ""}
                    >
                      <td>
                        <span className="receive-product">{row.label}</span>
                        <small className="receive-product-due">
                          {row.already > 0 ? `${row.already} of ${row.ordered} already handled · ${due} due` : `${row.ordered} ordered`}
                        </small>
                      </td>
                      <td className="receive-center receive-due">{due}</td>
                      <td>
                        <div className="receive-stepper">
                          <button type="button" aria-label={`Decrease accepted for ${row.label}`} disabled={busy} onClick={() => adjust(index, "accepted", -1)}>−</button>
                          <input
                            type="number" min="0" max={due} value={row.accepted}
                            onChange={(e) => setField(index, "accepted", e.target.value)}
                            aria-label={`Accepted for ${row.label}`}
                            disabled={busy}
                          />
                          <button type="button" aria-label={`Increase accepted for ${row.label}`} disabled={busy} onClick={() => adjust(index, "accepted", 1)}>+</button>
                        </div>
                      </td>
                      <td>
                        <div className="receive-stepper">
                          <button type="button" aria-label={`Decrease damaged for ${row.label}`} disabled={busy} onClick={() => adjust(index, "damaged", -1)}>−</button>
                          <input
                            type="number" min="0" max={due} value={row.damaged}
                            onChange={(e) => setField(index, "damaged", e.target.value)}
                            aria-label={`Damaged for ${row.label}`}
                            disabled={busy}
                          />
                          <button type="button" aria-label={`Increase damaged for ${row.label}`} disabled={busy} onClick={() => adjust(index, "damaged", 1)}>+</button>
                        </div>
                      </td>
                      <td>
                        <div className="receive-stepper">
                          <button type="button" aria-label={`Decrease missing for ${row.label}`} disabled={busy} onClick={() => adjust(index, "missing", -1)}>−</button>
                          <input
                            type="number" min="0" max={due} value={row.missing}
                            onChange={(e) => setField(index, "missing", e.target.value)}
                            aria-label={`Missing for ${row.label}`}
                            disabled={busy}
                          />
                          <button type="button" aria-label={`Increase missing for ${row.label}`} disabled={busy} onClick={() => adjust(index, "missing", 1)}>+</button>
                        </div>
                      </td>
                      <td className="receive-center">
                        <span className={`receive-total${rowOver ? " over" : rowDone ? " done" : ""}`}>
                          {recorded} / {due}
                          {rowOver && <small>exceeds due</small>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="receive-toolbar">
              <button type="button" className="filament-btn filament-btn-outline" onClick={fillDue} disabled={busy || overReceipt}>
                Fill all due
              </button>
              <button type="button" className="filament-btn filament-btn-outline" onClick={clearAll} disabled={busy}>
                Clear all
              </button>
            </div>

            <label className="form-row">
              <span className="input-hint">Notes (optional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="e.g. Received against delivery challan 1234, two cartons damaged in transit"
              />
            </label>
          </div>

          <div className="filament-modal-footer">
            <span className="receive-footer-note">
              {totals.accepted} into stock · {totals.damaged} damaged · {totals.missing} missing
            </span>
            <div className="filament-modal-footer-spacer" />
            <button type="button" className="filament-btn filament-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="filament-btn filament-btn-primary" disabled={busy || overReceipt || nothingToRecord}>
              {busy ? "Recording…" : "Record receipt"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── payment ────────────────────────────────────────────────────────────────

const PAYMENT_LABELS = {
  CASH: "Cash",
  BANK: "Bank transfer",
  UPI: "UPI",
  CARD: "Card",
  CHEQUE: "Cheque",
  CREDIT_NOTE: "Credit note",
};

export function PayModal({ invoice, onClose, onSubmit }) {
  const [amount, setAmount] = useState(String(invoice.outstanding ?? ""));
  const [method, setMethod] = useState("BANK");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  const outstanding = Number(invoice.outstanding);
  const value = Number(amount);
  const tooMuch = value > outstanding;
  const nothing = !(value > 0);
  const balanceAfter = Math.max(0, outstanding - (value > 0 ? value : 0));
  const paysFull = value === outstanding;

  const submit = async (event) => {
    event.preventDefault();
    if (tooMuch || nothing) return;
    setBusy(true);
    setLocalError("");
    try {
      await onSubmit({ amount: value, method, reference: reference || null, notes: notes || null });
    } catch (e) {
      setLocalError(e.message || "Unable to record this payment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="filament-modal-overlay" onClick={onClose}>
      <div className="filament-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="filament-modal-header">
          <div>
            <h2>Record payment</h2>
            <p className="filament-modal-sub">{invoice.invoice_number}</p>
          </div>
          <button type="button" className="filament-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form onSubmit={submit}>
          <div className="filament-modal-body">
            <div className="pay-balance">
              <div>
                <span className="pay-balance-label">Outstanding</span>
                <strong className="pay-balance-amount">{rupees(outstanding)}</strong>
              </div>
              <div className="pay-balance-after">
                <span className="pay-balance-label">After this payment</span>
                <strong>{rupees(balanceAfter)}</strong>
                {paysFull && <span className="pay-badge">Pays in full</span>}
              </div>
            </div>

            {localError && <Notice>{localError}</Notice>}
            {tooMuch && <Notice>That is more than the outstanding balance of {rupees(outstanding)}.</Notice>}

            <label className="form-row">
              <span className="input-hint">Amount</span>
              <input
                type="number"
                step="0.01"
                min="0"
                max={outstanding}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                autoFocus
              />
            </label>

            <div className="pay-quick">
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={() => setAmount(outstanding.toFixed(2))}
                disabled={busy}
              >
                Full {rupees(outstanding)}
              </button>
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={() => setAmount((outstanding / 2).toFixed(2))}
                disabled={busy}
              >
                Half
              </button>
            </div>

            <label className="form-row">
              <span className="input-hint">Method</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)} disabled={busy}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{PAYMENT_LABELS[m] || m}</option>
                ))}
              </select>
            </label>

            {(method === "BANK" || method === "UPI" || method === "CHEQUE") && (
              <label className="form-row">
                <span className="input-hint">Reference</span>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={method === "CHEQUE" ? "Cheque number" : "UTR / transaction id"}
                  disabled={busy}
                />
              </label>
            )}

            <label className="form-row">
              <span className="input-hint">Notes (optional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                disabled={busy}
              />
            </label>
          </div>

          <div className="filament-modal-footer">
            <span className="pay-footer-note">
              {nothing ? "Enter an amount" : tooMuch ? "More than outstanding" : `${rupees(value)} via ${PAYMENT_LABELS[method] || method}`}
            </span>
            <div className="filament-modal-footer-spacer" />
            <button type="button" className="filament-btn filament-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="filament-btn filament-btn-primary" disabled={busy || tooMuch || nothing}>
              {busy ? "Recording…" : "Record payment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── cancel ─────────────────────────────────────────────────────────────────

/*
 * Cancel an invoice in two steps: the operator writes the reason, then a
 * confirmation screen restates the consequences before anything is written.
 * The backend refuses an empty reason, so the first step is blocked until
 * there is a real one.
 */
export function CancelModal({ invoice, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  const trimmed = reason.trim();
  const receivedUnits = invoice.items.reduce(
    (s, i) => s + (Number(i.quantity_received) || 0),
    0
  );
  const paidSoFar = Number(invoice.total_amount) - Number(invoice.outstanding);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setLocalError("");
    try {
      await onSubmit(trimmed);
    } catch (e) {
      setLocalError(e.message || "Unable to cancel this invoice.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="filament-modal-overlay" onClick={onClose}>
      <div className="filament-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="filament-modal-header">
          <div>
            <h2>{confirming ? "Confirm cancellation" : "Cancel invoice"}</h2>
            <p className="filament-modal-sub">{invoice.invoice_number}</p>
          </div>
          <button type="button" className="filament-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {confirming ? (
          <>
            <div className="filament-modal-body">
              <div className="filament-alert filament-alert-danger">
                This cannot be undone. {invoice.invoice_number} will be marked
                cancelled and no further receiving or payment is possible.
              </div>
              <dl className="cancel-review">
                <div><dt>Reason</dt><dd>{trimmed}</dd></div>
                <div><dt>Lines</dt><dd>{invoice.items.length}</dd></div>
                <div>
                  <dt>Stock already received</dt>
                  <dd>{receivedUnits > 0 ? `${receivedUnits} unit(s) stay in stock` : "None"}</dd>
                </div>
                <div>
                  <dt>Paid so far</dt>
                  <dd>{rupees(paidSoFar)}</dd>
                </div>
              </dl>
            </div>
            <div className="filament-modal-footer">
              <button type="button" className="filament-btn filament-btn-outline" onClick={() => setConfirming(false)} disabled={busy}>
                Back
              </button>
              <button type="button" className="filament-btn filament-btn-danger" onClick={submit} disabled={busy}>
                {busy ? "Cancelling…" : "Yes, cancel invoice"}
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (trimmed) setConfirming(true);
            }}
          >
            <div className="filament-modal-body">
              {localError && <Notice>{localError}</Notice>}
              <div className="filament-alert filament-alert-info">
                Cancelling stops any further receiving or payment on this invoice.
                Stock already received stays in the warehouse.
              </div>
              <label className="form-row">
                <span className="input-hint">Reason (required)</span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Duplicate order, supplier cancelled the shipment…"
                  rows={3}
                  required
                  autoFocus
                />
              </label>
            </div>
            <div className="filament-modal-footer">
              <button type="button" className="filament-btn filament-btn-outline" onClick={onClose} disabled={busy}>
                Close
              </button>
              <button type="submit" className="filament-btn filament-btn-danger" disabled={!trimmed || busy}>
                Continue
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── create ─────────────────────────────────────────────────────────────────

function NewInvoiceModal({ onClose, onSaved, fullPage = false }) {
  const [suppliers, setSuppliers] = useState([]);
  const [lines, setLines] = useState([blankLine()]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [shippingTotal, setShippingTotal] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listSuppliers({ status: "active", limit: 100 })
      .then((d) => setSuppliers(d.suppliers || []))
      .catch((e) => setError(e.message));
  }, []);

  const setLine = (index, patch) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const removeLine = (index) =>
    setLines((current) => current.filter((_, i) => i !== index));

  // Products already on another line. Deliberately EMPTY.
//
// It used to be excluded from the picker on the assumption that a product may
// appear once per invoice. It may not: the server keys a line by product AND
// variant (lib/services/purchaseInvoice.js — "uniqueness is product+variant,
// not product alone"), so one product legitimately spans several lines, one per
// variant. Excluding it here made the form stricter than the server, and a
// 30-variant product could only ever be bought one variant at a time.
//
// The cost is that the picker no longer prevents a repeat, so the duplicate
// product+variant rule moves into `problems` below — the same rule, the same
// wording, checked before submit instead of after.
const usedUuids = [];

  const totals = useMemo(() => {
    const rows = lines.map(lineTotal);
    return {
      rows,
      gross: rows.reduce((sum, r) => sum + r.gross, 0),
      discount: rows.reduce((sum, r) => sum + r.discount, 0),
      tax: rows.reduce((sum, r) => sum + r.tax, 0),
      total: rows.reduce((sum, r) => sum + r.total, 0) + (Number(shippingTotal) || 0),
    };
  }, [lines, shippingTotal]);

  const problems = [];
  if (!supplierId) problems.push("Choose a supplier");
  if (!supplierInvoiceNumber.trim()) problems.push("Enter the supplier's invoice number");
  lines.forEach((line, index) => {
    if (!line.product) problems.push(`Line ${index + 1} needs a product`);
    else if (Array.isArray(line.product.variants) && line.product.variants.length > 0 && !line.variantUuid)
      problems.push(`Line ${index + 1} needs a variant`);
    else if (!(Number(line.quantityOrdered) > 0)) problems.push(`Line ${index + 1} needs a quantity above zero`);
    else if (Number(line.unitCost) < 0) problems.push(`Line ${index + 1} has a negative unit cost`);
    else if (line.sellingPrice !== "" && Number(line.sellingPrice) < 0) {
      problems.push(`Line ${index + 1} has a negative selling price`);
    }
  });

  // The same product+variant on two lines is refused by the server, so it is
  // refused here first — with the server's own wording, so the message does not
  // change depending on who caught it.
  const seenLines = new Map();
  lines.forEach((line, index) => {
    if (!line.product) return;
    const key = `${line.product.uuid}::${line.variantUuid || ""}`;
    if (seenLines.has(key)) {
      problems.push(
        line.variantUuid
          ? `The same product and variant appear twice (line ${index + 1}). Combine them into one line.`
          : `Line ${index + 1} repeats a product already on line ${seenLines.get(key) + 1}. Pick a variant, or combine the lines.`
      );
    } else {
      seenLines.set(key, index);
    }
  });

  const complete = problems.length === 0;

  const submit = async (event) => {
    event.preventDefault();
    if (!complete || busy) return;
    setBusy(true);
    setError("");
    try {
      // No totals are posted. The server derives every figure from these lines,
      // so anything sent here would be ignored at best and misleading at worst.
      const created = await createPurchaseInvoice({
        supplierId: Number(supplierId),
        supplierInvoiceNumber: supplierInvoiceNumber.trim(),
        invoiceDate,
        shippingTotal: Number(shippingTotal) || 0,
        notes: notes || null,
        items: lines.map((line) => ({
          productUuid: line.product.uuid,
          variantUuid: line.variantUuid || null,
          quantityOrdered: Number(line.quantityOrdered),
          unitCost: Number(line.unitCost),
          sellingPrice: line.sellingPrice === "" ? null : Number(line.sellingPrice),
          discountPercent: Number(line.discountPercent) || 0,
          taxPercent: Number(line.taxPercent) || 0,
        })),
      });
      onSaved?.(created);
      onClose?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const money = (value) => `\u20b9${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <>
      {fullPage && (
        <Breadcrumb
          items={[
            { label: "Purchase Invoices", to: "/purchase-invoices" },
            { label: "New Purchase Invoice" },
          ]}
        />
      )}
      <div className={fullPage ? "filament-page" : "filament-modal-overlay"} onClick={fullPage ? undefined : onClose}>
      <div className={fullPage ? "filament-card pp-new-page" : "filament-modal filament-modal-lg pp-modal"} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="filament-modal-header">
          <div>
            <h2>New purchase invoice</h2>
            <p className="filament-modal-sub">
              Book what a supplier has billed you. Totals are calculated by the server.
            </p>
          </div>
          <button type="button" className="filament-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form onSubmit={submit}>
          <div className="filament-modal-body">
            {error && <Notice>{error}</Notice>}
            {suppliers.length === 0 && (
              <Notice>
                No active suppliers yet. <a href="/suppliers">Add a supplier</a> before booking an invoice.
              </Notice>
            )}

            <div className="frm-grid">
              <label className="frm-field">
                <span>Supplier</span>
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Select a supplier…</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.uuid} value={supplier.id}>{supplier.name}</option>
                  ))}
                </select>
              </label>

              <label className="frm-field">
                <span>Supplier invoice number</span>
                <input
                  type="text"
                  value={supplierInvoiceNumber}
                  onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                  placeholder="The reference on their bill"
                />
              </label>

              <label className="frm-field">
                <span>Invoice date</span>
                <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </label>

              <label className="frm-field">
                <span>Shipping / other</span>
                <input
                  type="number" min="0" step="0.01" value={shippingTotal}
                  onChange={(e) => setShippingTotal(e.target.value)} placeholder="0.00"
                />
              </label>
            </div>

            <h3 className="frm-section">Line items</h3>
            <div className="pp-lines">
              <div className="pp-line pp-line-head">
                <span>Product</span>
                <span>Variant</span>
                <span>Qty</span>
                <span>Unit cost</span>
                <span>Selling price</span>
                <span>Disc %</span>
                <span>Tax %</span>
                <span className="pp-right">Line total</span>
                <span />
              </div>

              {lines.map((line, index) => (
                <div className="pp-line" key={index}>
                  <div className="pp-cell" data-label="Product">
                    <ProductPicker
                        value={line.product}
                        excludeUuids={usedUuids}
                        label="Search products…"
                        onChange={(product) => setLine(index, { product, variantUuid: "" })}
                    />
                  </div>
                  <div className="pp-cell" data-label="Variant">
                    {line.product && Array.isArray(line.product.variants) && line.product.variants.length > 0 ? (
                      <select
                        className="pp-variant-select ui-select"
                        value={line.variantUuid}
                        onChange={(e) => setLine(index, { variantUuid: e.target.value })}
                        required
                        aria-label={`Variant for line ${index + 1}`}
                      >
                        <option value="">Select variant…</option>
                        {sortVariants(line.product.variants).map((v) => (
                          <option key={v.uuid || v.sku} value={v.uuid || v.sku}>
                            {variantLabel(v)}
                          </option>
                        ))}
                      </select>
                    ) : line.product ? (
                      <span className="text-muted pp-no-variants">No variants</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </div>
                  <div className="pp-cell" data-label="Qty">
                    <input
                      type="number" min="0" step="0.01" className="pp-num"
                      value={line.quantityOrdered}
                      onChange={(e) => setLine(index, { quantityOrdered: e.target.value })}
                      placeholder="0"
                      aria-label={`Quantity for line ${index + 1}`}
                    />
                  </div>
                  <div className="pp-cell" data-label="Unit cost">
                    <input
                      type="number" min="0" step="0.01" className="pp-num"
                      value={line.unitCost}
                      onChange={(e) => setLine(index, { unitCost: e.target.value })}
                      placeholder="0.00"
                      aria-label={`Unit cost for line ${index + 1}`}
                    />
                  </div>
                  <div className="pp-cell" data-label="Selling price">
                  <span className="pp-sell">
                    <input
                      type="number" min="0" step="0.01" className="pp-num"
                      value={line.sellingPrice}
                      onChange={(e) => setLine(index, { sellingPrice: e.target.value })}
                      placeholder="sets price"
                      aria-label={`Selling price for line ${index + 1}`}
                    />
                    {(() => {
                      const m = marginOf(line);
                      if (!m) return null;
                      const bad = m.amount <= 0;
                      return (
                        <small className={bad ? "pp-margin-bad" : "pp-margin"}>
                          {bad ? "no margin" : `${Math.round(m.percent)}% margin`}
                        </small>
                      );
                    })()}
                  </span>
                  </div>
                  <div className="pp-cell" data-label="Disc %">
                  <input
                    type="number" min="0" max="100" className="pp-num"
                    value={line.discountPercent}
                    onChange={(e) => setLine(index, { discountPercent: e.target.value })}
                    placeholder="0"
                    aria-label={`Discount percent for line ${index + 1}`}
                  />
                  </div>
                  <div className="pp-cell" data-label="Tax %">
                  <input
                    type="number" min="0" max="100" className="pp-num"
                    value={line.taxPercent}
                    onChange={(e) => setLine(index, { taxPercent: e.target.value })}
                    placeholder="0"
                    aria-label={`Tax percent for line ${index + 1}`}
                  />
                  </div>
                  <div className="pp-cell" data-label="Line total">
                  <span className="pp-money">{money(totals.rows[index]?.total)}</span>
                  </div>
                  <button
                    type="button"
                    className="filament-btn filament-btn-small filament-btn-danger pp-remove"
                    onClick={() => removeLine(index)}
                    disabled={lines.length === 1}
                    aria-label={`Remove line ${index + 1}`}
                    title={lines.length === 1 ? "An invoice needs at least one line" : "Remove line"}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => setLines((c) => [...c, blankLine()])}
            >
              Add line
            </button>

            <dl className="pp-totals">
              <div><dt>Gross</dt><dd>{money(totals.gross)}</dd></div>
              <div><dt>Discount</dt><dd>− {money(totals.discount)}</dd></div>
              <div><dt>Tax</dt><dd>{money(totals.tax)}</dd></div>
              {Number(shippingTotal) > 0 && (
                <div><dt>Shipping / other</dt><dd>{money(shippingTotal)}</dd></div>
              )}
              <div className="pp-totals-grand"><dt>Invoice total</dt><dd>{money(totals.total)}</dd></div>
            </dl>

            <label className="frm-field">
              <span>Notes</span>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>

            {!complete && problems.length > 0 && (
              <ul className="pp-problems">
                {problems.map((problem) => <li key={problem}>{problem}</li>)}
              </ul>
            )}
          </div>

          <div className="filament-modal-footer">
            <button type="button" className="filament-btn filament-btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="filament-btn filament-btn-primary" disabled={busy || !complete}>
              {busy ? "Saving…" : "Create invoice"}
            </button>
          </div>
        </form>
      </div>
      </div>
    </>
  );
}

// sellingPrice is what this purchase sets as the product's retail price.
// unitCost stays the supplier's cost, so margin stays visible.
const blankLine = () => ({
  product: null, variantUuid: "", quantityOrdered: "", unitCost: "", sellingPrice: "",
  discountPercent: "", taxPercent: "",
});

// Readable name for a variant: its attribute combination is what a person
// recognises ("Black / M"), with the name preferred when one is set.
const variantLabel = (v) => {
  const fromAttributes =
    v.attributes && typeof v.attributes === "object"
      ? Object.values(v.attributes).filter(Boolean).join(" / ")
      : "";

  return v.name || fromAttributes || v.sku || "Variant";
};

// In-stock variants first, then alphabetical. A 30-variant product otherwise
// buries the ones you can actually buy, and "Black / M" appearing after "Black /
// XXL" makes the list feel arbitrary. Ties keep their original order, so nothing
// is reshuffled within a stock level.
const sortVariants = (variants) =>
  variants
    .map((variant, index) => ({ variant, index }))
    .sort((a, b) => {
      const stock = (Number(b.variant.stock) || 0) - (Number(a.variant.stock) || 0);
      if (stock !== 0) return stock;
      const label = variantLabel(a.variant).localeCompare(variantLabel(b.variant));
      if (label !== 0) return label;
      return a.index - b.index;
    })
    .map(({ variant }) => variant);

export function PurchaseInvoiceNew() {
  const navigate = useNavigate();
  return (
    <NewInvoiceModal
      fullPage
      onClose={() => navigate("/purchase-invoices")}
      onSaved={(created) => navigate(`/purchase-invoices/${created?.invoice?.id ?? created?.invoiceId ?? created?.id ?? ""}`)}
    />
  );
}
