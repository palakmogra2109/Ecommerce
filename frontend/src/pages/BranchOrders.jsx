import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getBranch, listBranchOrders, updateBranchOrderStatus } from "../services/branches";
import { ORDER_STATUS, ORDER_STATUS_LABELS, formatCurrency, formatDateTime } from "@shared/constants";
import Breadcrumb from "../components/Breadcrumb";

const NEXT_STATUS = {
  [ORDER_STATUS.PENDING]: ORDER_STATUS.CONFIRMED,
  [ORDER_STATUS.CONFIRMED]: ORDER_STATUS.PROCESSING,
  [ORDER_STATUS.PROCESSING]: ORDER_STATUS.PACKED,
  [ORDER_STATUS.PACKED]: ORDER_STATUS.SHIPPED,
  [ORDER_STATUS.SHIPPED]: ORDER_STATUS.OUT_FOR_DELIVERY,
  [ORDER_STATUS.OUT_FOR_DELIVERY]: ORDER_STATUS.DELIVERED,
};

const STATUS_COLORS = {
  PENDING: "#f59e0b",
  CONFIRMED: "#3b82f6",
  PROCESSING: "#8b5cf6",
  PACKED: "#ec4899",
  SHIPPED: "#0ea5e9",
  OUT_FOR_DELIVERY: "#f97316",
  DELIVERED: "#22c55e",
  CANCELLED: "#ef4444",
};

export default function BranchOrders() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [branch, setBranch] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    let active = true;
    const run = async () => {
      setLoading(true);
      try {
        const branchData = await getBranch(id);
        if (branchData.success && branchData.branch) setBranch(branchData.branch);
      } catch {}
      try {
        const params = { page: 1, limit: 20 };
        if (search) params.search = search;
        if (statusFilter) params.status = statusFilter;
        const result = await listBranchOrders(id, params);
        if (result.success && active) {
          setOrders(result.orders);
          setPagination(result.pagination);
        }
      } catch {}
      setLoading(false);
    };
    run();
    return () => { active = false; };
  }, [id, search, statusFilter]);

  async function handleStatusChange(order, newStatus) {
    const result = await updateBranchOrderStatus(id, order.uuid, newStatus);
    if (result.success) {
      const params = { page: pagination.page, limit: pagination.limit };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const data = await listBranchOrders(id, params);
      if (data.success) {
        setOrders(data.orders);
        setPagination(data.pagination);
      }
    }
  }

  async function handlePageChange(page) {
    const params = { page, limit: pagination.limit };
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;
    const data = await listBranchOrders(id, params);
    if (data.success) {
      setOrders(data.orders);
      setPagination(data.pagination);
    }
  }

  if (loading) return <div className="filament-empty"><div className="filament-spinner" /></div>;

  return (
    <div className="filament-page">
      <Breadcrumb items={[
        { label: "Branches", to: "/branches" },
        { label: branch?.name ?? "Branch", to: `/branches/${id}` },
        "Orders",
      ]} />

      <h1 className="filament-title">Branch Orders</h1>
      <p className="filament-card-subtitle">{branch?.name} — Manage and track orders</p>

      <div className="form-grid" style={{ marginBottom: 24 }}>
        <div>
          <input
            type="text"
            placeholder="Search orders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input"
            style={{ width: 300 }}
          />
        </div>
        <div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input"
          >
            <option value="">All Status</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="filament-empty"><p>No orders found.</p></div>
      ) : (
        <div className="variant-table-wrap">
          <table className="variant-edit-table">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Customer</th>
                <th>Total</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.uuid}>
                  <td>{o.order_number}</td>
                  <td>{o.customer_name}</td>
                  <td>{formatCurrency(o.total)}</td>
                  <td>
                    <span className="stock-badge-ok" style={{ background: STATUS_COLORS[o.status] ?? "#666" }}>
                      {ORDER_STATUS_LABELS[o.status] ?? o.status}
                    </span>
                  </td>
                  <td>{o.payment_method?.toUpperCase()}</td>
                  <td>{formatDateTime(o.created_at)}</td>
                  <td>
                    {NEXT_STATUS[o.status] && (
                      <button
                        className="sf-btn primary"
                        style={{ fontSize: 12, padding: "4px 12px" }}
                        onClick={() => handleStatusChange(o, NEXT_STATUS[o.status])}
                      >
                        {ORDER_STATUS_LABELS[NEXT_STATUS[o.status]]}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination.pages > 1 && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 24 }}>
          <button className="sf-btn ghost" disabled={pagination.page <= 1} onClick={() => handlePageChange(pagination.page - 1)}>Prev</button>
          <span style={{ display: "flex", alignItems: "center" }}>Page {pagination.page} of {pagination.pages}</span>
          <button className="sf-btn ghost" disabled={pagination.page >= pagination.pages} onClick={() => handlePageChange(pagination.page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
