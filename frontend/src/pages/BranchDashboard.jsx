import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { getBranchDashboard, getBranchStoreUsers, addBranchStoreUser, removeBranchStoreUser } from "../services/branches";
import { formatCurrency, ORDER_STATUS, ORDER_STATUS_LABELS } from "@shared/constants";
import Breadcrumb from "../components/Breadcrumb";
import { useAuth } from "../context/AuthContext";

function statCard(label, value, sub, color = "#6b7280") {
  return (
    <div className="view-box">
      <span className="view-box-label">{label}</span>
      <span className="view-box-value" style={{ color }}>
        {value}
      </span>
      {sub && <span className="input-hint" style={{ marginTop: 4 }}>{sub}</span>}
    </div>
  );
}

export default function BranchDashboard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [storeUsers, setStoreUsers] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const run = async () => {
      setLoading(true);
      try {
        const result = await getBranchDashboard(id);
        if (result.success && result.dashboard) {
          setData(result.dashboard);
        }
      } catch {}
      if (active) setLoading(false);
    };
    run();
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      setUsersLoading(true);
      try {
        const result = await getBranchStoreUsers(id);
        if (result.success) {
          setStoreUsers(result.users || []);
          setCandidates(result.candidates || []);
        }
      } catch {}
      if (active) setUsersLoading(false);
    };
    run();
    return () => { active = false; };
  }, [id]);

  async function handleAdd() {
    if (!selectedUser) return;
    setBusy(true);
    try {
      const result = await addBranchStoreUser(id, selectedUser);
      if (result.success) {
        const refresh = await getBranchStoreUsers(id);
        if (refresh.success) {
          setStoreUsers(refresh.users || []);
          setCandidates(refresh.candidates || []);
        }
        setSelectedUser("");
      }
    } catch {}
    setBusy(false);
  }

  async function handleRemove(userUuid) {
    setBusy(true);
    try {
      const result = await removeBranchStoreUser(id, userUuid);
      if (result.success) {
        const refresh = await getBranchStoreUsers(id);
        if (refresh.success) {
          setStoreUsers(refresh.users || []);
          setCandidates(refresh.candidates || []);
        }
      }
    } catch {}
    setBusy(false);
  }

  if (loading) return <div className="filament-empty"><div className="filament-spinner" /></div>;
  if (!data) return <div className="filament-empty"><p>Branch dashboard not found.</p></div>;

  const { branch, stats, lowStock, outOfStock, todayOrders } = data;

  return (
    <div className="filament-page">
      <Breadcrumb items={[
        { label: "Branches", to: "/branches" },
        { label: branch?.name, to: `/branches/${id}` },
        "Dashboard",
      ]} />

      <h1 className="filament-title">{branch?.name} — Dashboard</h1>
      <p className="filament-card-subtitle">{branch?.city}, {branch?.code} · {branch?.status}</p>

      <div className="view-grid" style={{ marginBottom: 24 }}>
        {statCard("Total Products", stats?.totalProducts ?? 0, "Active branch products")}
        {statCard("Total Stock", stats?.totalStock ?? 0, "All variants")}
        {statCard("Low Stock Items", stats?.lowStockCount ?? 0, "≤ threshold", "#f59e0b")}
        {statCard("Out of Stock", stats?.outOfStockCount ?? 0, "No inventory", "#ef4444")}
        {statCard("Total Inventory Value", formatCurrency(stats?.totalValue ?? 0), "Selling price")}
        {statCard("Today's Orders", todayOrders?.length ?? 0, "Orders placed today")}
      </div>

      <div className="form-grid" style={{ marginBottom: 24 }}>
        <div>
          <h3 className="form-section-title">Low Stock Products</h3>
          {lowStock.length === 0 ? (
            <p className="input-hint">All products are well stocked.</p>
          ) : (
            <div className="variant-table-wrap">
              <table className="variant-edit-table">
                <thead><tr><th>Product</th><th>Stock</th><th>Threshold</th><th>Price</th></tr></thead>
                <tbody>
                  {lowStock.map((p, i) => (
                    <tr key={i}>
                      <td>{p.productName}</td>
                      <td><span className="stock-badge-low">{p.stockQuantity}</span></td>
                      <td>{p.lowStockThreshold}</td>
                      <td>{formatCurrency(p.sellingPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h3 className="form-section-title">Out of Stock</h3>
          {outOfStock.length === 0 ? (
            <p className="input-hint">All products have stock.</p>
          ) : (
            <div className="variant-table-wrap">
              <table className="variant-edit-table">
                <thead><tr><th>Product</th><th>Stock</th><th>MRP</th></tr></thead>
                <tbody>
                  {outOfStock.map((p, i) => (
                    <tr key={i}>
                      <td>{p.productName}</td>
                      <td><span className="stock-badge-out">0</span></td>
                      <td>{formatCurrency(p.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h3 className="form-section-title">Today's Orders</h3>
          {todayOrders.length === 0 ? (
            <p className="input-hint">No orders today.</p>
          ) : (
            <div className="variant-table-wrap">
              <table className="variant-edit-table">
                <thead><tr><th>Order #</th><th>Status</th><th>Total</th></tr></thead>
                <tbody>
                  {todayOrders.map((o, i) => (
                    <tr key={i}>
                      <td>{o.order_number}</td>
                      <td><span className="stock-badge-ok">{o.status}</span></td>
                      <td>{formatCurrency(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link to={`/branches/${id}/orders`} className="sf-btn primary" style={{ marginTop: 12, display: "inline-block" }}>View All Orders</Link>
        </div>
      </div>

      <h3 className="form-section-title">Store Users</h3>
      <p className="filament-card-subtitle">
        Accounts with the Store role linked to this branch. Store users can sign in to the store panel and manage this branch.
      </p>

      {usersLoading ? (
        <div className="filament-empty"><div className="filament-spinner" /></div>
      ) : (
        <div className="variant-table-wrap" style={{ marginBottom: 16 }}>
          <table className="variant-edit-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Mobile</th>
                <th>Status</th>
                {can("branches.update") && <th style={{ width: 90 }}></th>}
              </tr>
            </thead>
            <tbody>
              {storeUsers.map((u) => (
                <tr key={u.uuid}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.mobile || "—"}</td>
                  <td><span className={u.status === "ACTIVE" ? "stock-badge-ok" : "stock-badge-out"}>{u.status}</span></td>
                  {can("branches.update") && (
                    <td>
                      <button
                        className="filament-btn filament-btn-danger"
                        disabled={busy}
                        onClick={() => handleRemove(u.uuid)}
                      >Unlink</button>
                    </td>
                  )}
                </tr>
              ))}
              {storeUsers.length === 0 && (
                <tr>
                  <td colSpan={can("branches.update") ? 5 : 4} className="input-hint">
                    No store users linked to this branch yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {can("branches.update") && (
        <div className="form-row" style={{ alignItems: "center", gap: 12 }}>
          <select
            className="form-control"
            value={selectedUser}
            onChange={(e) => setSelectedUser(e.target.value)}
            style={{ maxWidth: 340 }}
          >
            <option value="">Select a store user…</option>
            {candidates.map((u) => (
              <option key={u.uuid} value={u.uuid}>{u.name} · {u.email}</option>
            ))}
          </select>
          <button
            className="sf-btn primary"
            disabled={busy || !selectedUser}
            onClick={handleAdd}
          >Link to Branch</button>
          {candidates.length === 0 && (
            <span className="input-hint">No unlinked store accounts available.</span>
          )}
        </div>
      )}
    </div>
  );
}
