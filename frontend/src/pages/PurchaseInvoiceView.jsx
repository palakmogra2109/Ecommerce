import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getPurchaseInvoice, receiveStock, payPurchaseInvoice, cancelPurchaseInvoice,
} from "../services/purchases";
import { useAuth } from "../context/AuthContext";
import { Notice, ReceiveModal, PayModal, CancelModal, rupees } from "./PurchaseInvoices";

export default function PurchaseInvoiceView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  // busy is toggled by act() while a request runs; the modals read their own
  // busy state, so the value itself is not needed here.
  const [, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const reload = useCallback(async () => {
    const data = await getPurchaseInvoice(id);
    setInvoice(data.invoice);
    return data.invoice;
  }, [id]);

  useEffect(() => {
    reload()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [reload]);

  const act = async (fn, successText) => {
    setBusy(true);
    setError("");
    setOk("");
    try {
      await fn();
      if (successText) setOk(successText);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (loading) return <div className="filament-page"><div className="filament-empty">Loading…</div></div>;
  if (!invoice) {
    return (
      <div className="filament-page">
        <Notice>{error || "Purchase invoice not found."}</Notice>
        <button type="button" className="filament-btn filament-btn-outline" onClick={() => navigate("/purchase-invoices")}>
          Back to purchase invoices
        </button>
      </div>
    );
  }

  const received = invoice.items.reduce((s, i) => s + (Number(i.quantity_received) || 0), 0);
  const ordered = invoice.items.reduce((s, i) => s + (Number(i.quantity_ordered) || 0), 0);
  const closed = invoice.status === "CANCELLED";
  const settled = Number(invoice.outstanding) === 0;

  /*
   * Receive stock is offered only while at least one line still has units
   * due (ordered minus received, damaged and missing). When everything is
   * accounted for the button is hidden entirely instead of sitting disabled.
   */
  const anyDue = invoice.items.some(
    (item) =>
      Number(item.quantity_ordered) -
        Number(item.quantity_received) -
        Number(item.quantity_damaged) -
        Number(item.quantity_rejected) >
      0
  );

  return (
    <>
    <div className="filament-page">
      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h2>{invoice.invoice_number}</h2>
            <p className="filament-card-subtitle">
              Supplier ref {invoice.supplier_invoice_number} ·{" "}
              {invoice.status.replace(/_/g, " ").toLowerCase()} ·{" "}
              {invoice.payment_status.replace(/_/g, " ").toLowerCase()}
            </p>
          </div>
          <div className="filament-card-header-right">
            <button type="button" className="filament-btn filament-btn-outline" onClick={() => navigate("/purchase-invoices")}>
              Back
            </button>
          </div>
        </div>

        <Notice>{error}</Notice>
        <Notice>{ok}</Notice>

        <div className="filament-card-filters">
          <div><span className="form-label">Total</span><strong>{rupees(invoice.total_amount)}</strong></div>
          <div>
            <span className="form-label">Paid</span>
            <strong>{rupees(Number(invoice.total_amount) - Number(invoice.outstanding))}</strong>
          </div>
          <div><span className="form-label">Outstanding</span><strong>{rupees(invoice.outstanding)}</strong></div>
          <div><span className="form-label">Units</span><strong>{received} of {ordered} received</strong></div>
        </div>

        <table className="filament-table">
          <thead>
            <tr>
              <th>Product</th><th>Ordered</th><th>Received</th><th>Damaged</th>
              <th>Missing</th><th>Unit cost</th><th>Line total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item) => {
              const due =
                Number(item.quantity_ordered) - Number(item.quantity_received) -
                Number(item.quantity_damaged) - Number(item.quantity_rejected);
              return (
                <tr key={item.id}>
                  <td>{item.name || item.sku}</td>
                  <td>{item.quantity_ordered}</td>
                  <td>{item.quantity_received}</td>
                  <td>{item.quantity_damaged}</td>
                  <td>{item.quantity_rejected}</td>
                  <td>{rupees(item.unit_cost)}</td>
                  <td>{rupees(item.line_total)}{due > 0 && <small>{due} still due</small>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {invoice.payments?.length > 0 && (
          <table className="filament-table">
            <thead>
              <tr><th>Paid at</th><th>Method</th><th>Reference</th><th>Amount</th><th>Balance after</th></tr>
            </thead>
            <tbody>
              {invoice.payments.map((payment) => (
                <tr key={payment.id}>
                  <td>{new Date(payment.paid_at).toLocaleString("en-IN")}</td>
                  <td>{payment.method}</td>
                  <td>{payment.reference || "—"}</td>
                  <td>{rupees(payment.amount)}</td>
                  <td>{rupees(payment.balance_after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="filament-modal-footer" style={{ border: "none" }}>
          {can("purchase_invoices.receive") && !closed && anyDue && (
            <button
              type="button" className="filament-btn filament-btn-primary"
              onClick={() => setReceiveOpen(true)}
            >
              Receive stock
            </button>
          )}
          {can("purchase_invoices.pay") && !closed && !settled && (
            <button type="button" className="filament-btn filament-btn-primary" onClick={() => setPayOpen(true)}>
              Record payment
            </button>
          )}
          {can("purchase_invoices.cancel") && !closed && (
            <button
              type="button" className="filament-btn filament-btn-danger"
              onClick={() => setCancelOpen(true)}
            >
              Cancel invoice
            </button>
          )}
        </div>
      </div>

    </div>
    <PurchaseInvoiceModals
      invoice={invoice}
      receiveOpen={receiveOpen}
      setReceiveOpen={setReceiveOpen}
      payOpen={payOpen}
      setPayOpen={setPayOpen}
      cancelOpen={cancelOpen}
      setCancelOpen={setCancelOpen}
      act={act}
      reload={reload}
    />
    </>
  );
}

/* Receive and Pay are siblings of the page, never children of it, for the same
   reason as the supplier bank form: nested fixed overlays race on paint order
   and the wrong one swallows the clicks. */
export function PurchaseInvoiceModals({ invoice, receiveOpen, setReceiveOpen, payOpen,
                                       setPayOpen, cancelOpen, setCancelOpen, act, reload }) {
  return (
    <>
      {receiveOpen && (
        <ReceiveModal
          invoice={invoice}
          onClose={() => setReceiveOpen(false)}
          onSubmit={async (lines, notes) => {
            await act(async () => {
              await receiveStock(invoice.uuid, { lines, notes });
              await reload();
            }, "Stock received");
            setReceiveOpen(false);
          }}
        />
      )}
      {payOpen && (
        <PayModal
          invoice={invoice}
          onClose={() => setPayOpen(false)}
          onSubmit={async (payload) => {
            await act(async () => {
              await payPurchaseInvoice(invoice.uuid, payload);
              await reload();
            }, "Payment recorded");
            setPayOpen(false);
          }}
        />
      )}
      {cancelOpen && (
        <CancelModal
          invoice={invoice}
          onClose={() => setCancelOpen(false)}
          onSubmit={async (reason) => {
            await act(async () => {
              await cancelPurchaseInvoice(invoice.uuid, reason);
              await reload();
            }, "Invoice cancelled");
            setCancelOpen(false);
          }}
        />
      )}
    </>
  );
}

