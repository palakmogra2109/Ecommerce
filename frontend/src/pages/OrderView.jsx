import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  getOrder,
  updateOrder,
  cancelOrder,
  downloadInvoice,
} from "../services/orders";
import Breadcrumb from "../components/Breadcrumb";
import { useAuth } from "../context/AuthContext";
import {
  ORDER_STATUS,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS,
  PAYMENT_STATUS_LABELS,
  ORDER_PAYMENT_METHODS_LABELS,
  formatCurrency,
  formatDateTime,
} from "@shared/constants";

const TERMINAL = [ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED];
const CANNOT_CANCEL = [
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.REFUNDED,
  ORDER_STATUS.DELIVERED,
];

export default function OrderView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canUpdateOrder = can("orders.update");
  const canCancelOrder = can("orders.cancel");

  const [order, setOrder] = useState(null);
  const [orderFlow, setOrderFlow] = useState([]);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id || id === "undefined" || id === "null") {
      navigate("/orders", { replace: true });
      return;
    }

    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        const data = await getOrder(id);

        if (!active) {
          return;
        }

        if (data.success) {
          setOrder(data.order);
          setOrderFlow(data.orderFlow || []);
        } else {
          setMessage(data.message || "Order not found");
        }
      } catch {
        if (!active) {
          return;
        }

        setMessage("Unable to connect to the server. Please try again.");
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
  }, [id, navigate]);

  async function save(payload) {
    setBusy(true);
    setMessage("");

    try {
      const data = await updateOrder(id, payload);

      if (data.success) {
        const fresh = await getOrder(id);

        if (fresh.success) {
          setOrder(fresh.order);
          setOrderFlow(fresh.orderFlow || []);
          setMessage(data.message);
        }
      } else {
        setMessage(data.message);
      }
    } catch {
      setMessage("Unable to connect to the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function advance() {
    if (!order || !orderFlow.length) {
      return;
    }

    const idx = orderFlow.indexOf(order.status);

    if (idx < 0 || idx >= orderFlow.length - 1) {
      return;
    }

    await save({ status: orderFlow[idx + 1] });
  }

  // Downloads the order bill PDF and saves it via a temporary object URL.
  async function handleDownloadInvoice() {
    setInvoiceBusy(true);
    try {
      const blob = await downloadInvoice(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${order?.order_number || id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setMessage("Could not download the invoice. Please try again.");
    } finally {
      setInvoiceBusy(false);
    }
  }

  async function handleCancel() {
    const confirmed = window.confirm(
      "Cancel this order? This cannot be undone."
    );

    if (!confirmed) {
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const data = await cancelOrder(id);

      if (data.success) {
        const fresh = await getOrder(id);

        if (fresh.success) {
          setOrder(fresh.order);
          setOrderFlow(fresh.orderFlow || []);
          setMessage(data.message);
        }
      } else {
        setMessage(data.message);
      }
    } catch {
      setMessage("Unable to connect to the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="filament-page">
        <div className="filament-empty">
          <div className="filament-spinner" />
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="filament-page">
        <div className="filament-alert">{message || "Order not found"}</div>
      </div>
    );
  }

  const currentIdx = orderFlow.indexOf(order.status);
  const terminal = TERMINAL.includes(order.status);
  const canAdvance = currentIdx >= 0 && currentIdx < orderFlow.length - 1;

  return (
    <div className="filament-page">
      <Breadcrumb
        items={[
          { label: "Orders", to: "/orders" },
          { label: order.order_number },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>{order.order_number}</h1>
            <span
              className={`filament-badge filament-badge-${String(order.status || "").toLowerCase()}`}
            >
              <span className="filament-badge-dot" />
              {ORDER_STATUS_LABELS[order.status] || order.status}
            </span>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/orders")}
            >
              ← Back
            </button>
            <button
              type="button"
              className="filament-btn filament-btn-secondary"
              disabled={invoiceBusy}
              onClick={handleDownloadInvoice}
            >
              {invoiceBusy ? "Preparing…" : "Download Bill (PDF)"}
            </button>
            {canCancelOrder && !terminal && (
              <button
                type="button"
                className="filament-btn filament-btn-danger"
                disabled={busy || CANNOT_CANCEL.includes(order.status)}
                onClick={handleCancel}
                title={
                  CANNOT_CANCEL.includes(order.status)
                    ? "This order cannot be cancelled at this stage."
                    : undefined
                }
              >
                Cancel Order
              </button>
            )}
          </div>
        </div>

        {orderFlow.length > 0 && (
          <div className="order-timeline">
            {orderFlow.map((step, index) => (
              <div
                key={step}
                className={`order-timeline-step${
                  index < currentIdx || order.status === step
                    ? " order-timeline-step-done"
                    : ""
                }`}
              >
                <span className="order-timeline-dot" />
                <span className="order-timeline-label">
                  {ORDER_STATUS_LABELS[step]}
                </span>
              </div>
            ))}
          </div>
        )}

        {terminal ? (
          <p className="template-hint">
            This order is in a terminal state ({ORDER_STATUS_LABELS[order.status]}) and
            can no longer be changed.
          </p>
        ) : (
          canUpdateOrder && (
          <div className="order-actions">
            <button
              type="button"
              className="filament-btn filament-btn-primary"
              disabled={busy || !canAdvance}
              onClick={advance}
            >
              {canAdvance
                ? `Move to ${ORDER_STATUS_LABELS[orderFlow[currentIdx + 1]]}`
                : "No further steps in the flow"}
            </button>

            <div className="pay-status-control">
              <label className="form-label">Payment status</label>
              <select
                value={order.payment_status}
                disabled={busy}
                onChange={(e) => save({ paymentStatus: e.target.value })}
              >
                {Object.values(PAYMENT_STATUS).map((value) => (
                  <option key={value} value={value}>
                    {PAYMENT_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          )
        )}

        <div className="stat-grid">
          <div className="stat-card">
            <span className="stat-value">{formatCurrency(order.total)}</span>
            <span className="stat-label">Total</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{formatCurrency(order.subtotal)}</span>
            <span className="stat-label">Subtotal</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">−{formatCurrency(order.discount)}</span>
            <span className="stat-label">Discount</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">
              {order.coupon_code || "—"}
            </span>
            <span className="stat-label">Coupon</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{formatDateTime(order.created_at)}</span>
            <span className="stat-label">Placed</span>
          </div>
        </div>

        <div className="detail-grid">
          <div className="detail-block">
            <h3>Customer</h3>
            {order.customer_uuid ? (
              <p>
                <Link to={`/customers/${order.customer_uuid}`}>
                  <strong>{order.customer_name}</strong>
                </Link>
              </p>
            ) : (
              <p>
                <strong>{order.customer_name}</strong>
              </p>
            )}
            <p>{order.customer_email}</p>
            <p>{order.customer_mobile || "—"}</p>
          </div>

          <div className="detail-block">
            <h3>Shipping Address</h3>
            <p>
              {[
                order.shipping_address?.line1,
                order.shipping_address?.city,
                order.shipping_address?.state,
                order.shipping_address?.postal,
                order.shipping_address?.country,
              ]
                .filter(Boolean)
                .join(", ") || "—"}
            </p>
          </div>

          <div className="detail-block">
            <h3>Payment</h3>
            <p>
              <span
                className={`filament-badge filament-badge-${String(order.payment_status || "").toLowerCase()}`}
              >
                <span className="filament-badge-dot" />
                {PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status}
              </span>
            </p>
            <p>
              {ORDER_PAYMENT_METHODS_LABELS[order.payment_method] ||
                order.payment_method}
            </p>
          </div>
        </div>
      </div>

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h2>Items</h2>
          </div>
        </div>

        <div className="filament-table-wrap">
          <table className="filament-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Variant</th>
                <th>Price</th>
                <th>Qty</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {(order.items || []).length === 0 ? (
                <tr>
                  <td colSpan="5" className="filament-empty">
                    No items on this order.
                  </td>
                </tr>
              ) : (
                order.items.map((item, index) => (
                  <tr key={item.uuid || index}>
                    <td>
                      <strong>{item.product_name}</strong>
                      <span className="filament-muted"> · {item.sku}</span>
                    </td>
                    <td>{item.variant || "—"}</td>
                    <td>{formatCurrency(item.price)}</td>
                    <td>{item.quantity}</td>
                    <td>
                      <strong>{formatCurrency(item.subtotal)}</strong>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}