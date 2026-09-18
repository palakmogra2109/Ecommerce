import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getCustomer, updateCustomer, deleteCustomer } from "../services/customers";
import Breadcrumb from "../components/Breadcrumb";
import { useAuth } from "../context/AuthContext";
import {
  CUSTOMER_STATUS,
  formatCurrency,
  formatDateTime,
  ORDER_STATUS_LABELS,
} from "@shared/constants";

export default function CustomerView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canUpdateCustomer = can("customers.update");
  const canDeleteCustomer = can("customers.delete");

  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    mobile: "",
    status: "",
    addressLine1: "",
    city: "",
    state: "",
    postal: "",
    country: "",
  });

  useEffect(() => {
    if (!id || id === "undefined" || id === "null") {
      navigate("/customers", { replace: true });
      return;
    }

    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        const data = await getCustomer(id);

        if (!active) {
          return;
        }

        if (data.success) {
          setCustomer(data.customer);
        } else {
          setMessage(data.message || "Customer not found");
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

  function startEdit() {
    const customerObj = customer || {};
    const addr = customerObj.address || {};

    setForm({
      name: customerObj.name || "",
      mobile: customerObj.mobile || "",
      status: customerObj.status || "",
      addressLine1: addr.line1 || "",
      city: addr.city || "",
      state: addr.state || "",
      postal: addr.postal || "",
      country: addr.country || "",
    });
    setEditing(true);
  }

  async function handleSave(e) {
    e.preventDefault();

    setSaving(true);
    setMessage("");

    try {
      const payload = {
        name: form.name,
        mobile: form.mobile,
        status: form.status,
        address: {
          line1: form.addressLine1,
          city: form.city,
          state: form.state,
          postal: form.postal,
          country: form.country,
        },
      };

      const data = await updateCustomer(id, payload);

      if (!data.success) {
        setMessage(data.message);
        return;
      }

      const fresh = await getCustomer(id);

      if (fresh.success) {
        setCustomer(fresh.customer);
      }

      setEditing(false);
    } catch {
      setMessage("Unable to connect to the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      "Delete this customer? Their orders will be kept with copied contact details."
    );

    if (!confirmed) {
      return;
    }

    setMessage("");

    try {
      const data = await deleteCustomer(id);

      if (data.success) {
        navigate("/customers", { replace: true });
      } else {
        setMessage(data.message);
      }
    } catch {
      setMessage("Unable to connect to the server. Please try again.");
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

  if (!customer) {
    return (
      <div className="filament-page">
        <div className="filament-alert">{message || "Customer not found"}</div>
      </div>
    );
  }

  const address = customer.address || {};

  return (
    <div className="filament-page">
      <Breadcrumb
        items={[
          { label: "Customers", to: "/customers" },
          { label: customer.name },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>{customer.name}</h1>
            <span
              className={`filament-badge filament-badge-${(customer.status || "").toLowerCase()}`}
            >
              <span className="filament-badge-dot" />
              {customer.status}
            </span>
          </div>
          <div className="filament-card-header-right">
            {!editing ? (
              <>
                <button
                  type="button"
                  className="filament-btn filament-btn-outline"
                  onClick={() => navigate("/customers")}
                >
                  ← Back
                </button>
                {canUpdateCustomer && (
                  <button
                    type="button"
                    className="filament-btn filament-btn-primary"
                    onClick={startEdit}
                  >
                    Edit
                  </button>
                )}
                {canDeleteCustomer && (
                  <button
                    type="button"
                    className="filament-btn filament-btn-danger"
                    onClick={handleDelete}
                  >
                    Delete
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                className="filament-btn filament-btn-outline"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="stat-grid">
          <div className="stat-card">
            <span className="stat-value">{customer.stats?.orderCount ?? 0}</span>
            <span className="stat-label">Orders</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">
              {formatCurrency(customer.stats?.totalSpentValid ?? 0)}
            </span>
            <span className="stat-label">Lifetime spend</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{customer.stats?.cancelledCount ?? 0}</span>
            <span className="stat-label">Cancelled</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">
              {formatDateTime(customer.created_at)}
            </span>
            <span className="stat-label">Joined</span>
          </div>
        </div>

        {editing ? (
          <form className="admin-form resource-form" onSubmit={handleSave}>
            <h2 className="form-section-title">Contact Details</h2>

            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                />
              </div>

              <div className="form-row">
                <label className="form-label">Mobile</label>
                <input
                  type="text"
                  value={form.mobile}
                  onChange={(e) => setForm((p) => ({ ...p, mobile: e.target.value }))}
                />
              </div>

              <div className="form-row">
                <label className="form-label">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
                >
                  <option value={CUSTOMER_STATUS.ACTIVE}>Active</option>
                  <option value={CUSTOMER_STATUS.INACTIVE}>Inactive</option>
                  <option value={CUSTOMER_STATUS.SUSPENDED}>Suspended</option>
                </select>
              </div>
            </div>

            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">Address Line 1</label>
                <input
                  type="text"
                  value={form.addressLine1}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, addressLine1: e.target.value }))
                  }
                />
              </div>
              <div className="form-row">
                <label className="form-label">City</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, city: e.target.value }))
                  }
                />
              </div>
              <div className="form-row">
                <label className="form-label">State</label>
                <input
                  type="text"
                  value={form.state}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, state: e.target.value }))
                  }
                />
              </div>
              <div className="form-row">
                <label className="form-label">Postal Code</label>
                <input
                  type="text"
                  value={form.postal}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, postal: e.target.value }))
                  }
                />
              </div>
              <div className="form-row">
                <label className="form-label">Country</label>
                <input
                  type="text"
                  value={form.country}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, country: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="filament-btn filament-btn-primary" disabled={saving}>
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        ) : (
          <div className="detail-grid">
            <div className="detail-block">
              <h3>Email</h3>
              <p>{customer.email}</p>
            </div>
            <div className="detail-block">
              <h3>Mobile</h3>
              <p>{customer.mobile || "—"}</p>
            </div>
            <div className="detail-block">
              <h3>Address</h3>
              <p>
                {[
                  address.line1,
                  address.city,
                  address.state,
                  address.postal,
                  address.country,
                ]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h2>Recent Orders</h2>
          </div>
        </div>

        <div className="filament-table-wrap">
          <table className="filament-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Status</th>
                <th className="filament-th-actions" />
              </tr>
            </thead>
            <tbody>
              {(customer.recentOrders || []).length === 0 ? (
                <tr>
                  <td colSpan="6" className="filament-empty">
                    No orders yet.
                  </td>
                </tr>
              ) : (
                customer.recentOrders.map((order) => (
                  <tr key={order.uuid}>
                    <td>
                      <Link to={`/orders/${order.uuid}`}>
                        <strong>{order.order_number}</strong>
                      </Link>
                    </td>
                    <td>{formatDateTime(order.created_at)}</td>
                    <td>
                      <strong>{formatCurrency(order.total)}</strong>
                    </td>
                    <td>{String(order.payment_status || "").toLowerCase()}</td>
                    <td>
                      <span
                        className={`filament-badge filament-badge-${String(order.status || "").toLowerCase()}`}
                      >
                        <span className="filament-badge-dot" />
                        {ORDER_STATUS_LABELS?.[order.status] || order.status}
                      </span>
                    </td>
                    <td>
                      <Link
                        className="filament-action-btn"
                        to={`/orders/${order.uuid}`}
                        title="View order"
                      >
                        <svg viewBox="0 0 24 24">
                          <path d="M12 4.5C7 4.5 2.7 8.1 1.5 12c1.2 3.9 5.5 7.5 10.5 7.5s9.3-3.6 10.5-7.5C21.3 8.1 17 4.5 12 4.5Zm0 12a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
                        </svg>
                      </Link>
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