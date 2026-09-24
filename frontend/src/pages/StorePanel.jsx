import { useState, useEffect, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { FiSearch } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { storeDashboard, storeProducts, storeOrders, storeUpdateOrder, storeUpdateProduct, storeCancelOrder } from "../services/store";
import StoreOnboarding from "./StoreOnboarding";
import StoreSidebar from "../components/StoreSidebar";

export default function StorePanel() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState("dashboard");
  const [loading, setLoading] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [products, setProducts] = useState([]);
  const [productPage, setProductPage] = useState(1);
  const [productTotal, setProductTotal] = useState(0);
  const [orders, setOrders] = useState([]);
  const [orderPage, setOrderPage] = useState(1);
  const [orderTotal, setOrderTotal] = useState(0);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("");
  const [editingProduct, setEditingProduct] = useState(null);
  const [editPrice, setEditPrice] = useState("");
  const [editCompareAt, setEditCompareAt] = useState("");
  const [editStock, setEditStock] = useState("");
  const [editLowStock, setEditLowStock] = useState("");
  const [branchId, setBranchId] = useState("");

  const branches = user?.branches || [];
  const branch = branches.find((b) => (b.uuid || b.id) === branchId) || branches[0];
  const branchUuid = (branch && (branch.uuid || branch.id)) || "";

  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }
    if (branches.length === 0) {
      navigate("/no-store");
      return;
    }
    setBranchId((current) => current || branches[0].uuid || branches[0].id || "");
  }, [user]);

  // Store managers must complete onboarding before using the panel.
  useEffect(() => {
    if (branch && branch.onboardingCompleted === false) {
      navigate("/manager/onboarding", { replace: true });
    }
  }, [branch, tab]);

  useEffect(() => {
    if (!branchUuid) return;
    if (tab === "dashboard") loadDashboard();
    else if (tab === "products") loadProducts();
    else if (tab === "orders") loadOrders();
  }, [branchUuid, tab, productPage, orderPage, orderSearch, orderStatusFilter]);

  async function loadDashboard() {
    setLoading(true);
    try {
      const data = await storeDashboard(branchUuid);
      if (data.success) setDashboard(data);
    } catch {}
    setLoading(false);
  }

  async function loadProducts() {
    setLoading(true);
    try {
      const data = await storeProducts(branchUuid, { page: productPage, limit: 20 });
      if (data.success) {
        setProducts((data.products || []).map((p) => ({
          uuid: p.branchproductuuid || p.uuid,
          name: p.name,
          sku: p.sku,
          images: p.images,
          category_name: p.category_name,
          sellingPrice: p.sellingPrice ?? p.sellingprice,
          compareAtPrice: p.compareAtPrice ?? p.compareatprice,
          stockQuantity: p.stockQuantity ?? p.stockquantity,
          lowStockThreshold: p.lowStockThreshold ?? p.lowstockthreshold,
        })));
        setProductTotal(data.pagination.total);
      }
    } catch {}
    setLoading(false);
  }

  async function loadOrders() {
    setLoading(true);
    try {
      const params = { page: orderPage, limit: 20 };
      if (orderSearch) params.search = orderSearch;
      if (orderStatusFilter) params.status = orderStatusFilter;
      const data = await storeOrders(branchUuid, params);
      if (data.success) {
        setOrders((data.orders || []).map((o) => ({
          uuid: o.uuid,
          orderNumber: o.order_number || o.orderNumber,
          customerName: o.customer_name || o.customerName,
          customerEmail: o.customer_email || o.customerEmail,
          customerMobile: o.customer_mobile || o.customerMobile,
          subtotal: o.subtotal,
          total: o.total,
          paymentMethod: o.payment_method || o.paymentMethod,
          paymentStatus: o.payment_status || o.paymentStatus,
          status: o.status,
          itemCount: o.item_count || o.itemCount,
          createdAt: o.created_at || o.createdAt,
        })));
        setOrderTotal(data.pagination.total);
      }
    } catch {}
    setLoading(false);
  }

  async function handleUpdateProduct(product) {
    const result = await storeUpdateProduct(branchUuid, product.uuid, {
      sellingPrice: editPrice || product.sellingPrice,
      compareAtPrice: editCompareAt === "" ? (product.compareAtPrice ?? null) : Number(editCompareAt) || null,
      stockQuantity: editStock || product.stockQuantity,
      lowStockThreshold: editLowStock === "" ? product.lowStockThreshold : Number(editLowStock) || 5,
    });
    if (result.success) {
      setEditingProduct(null);
      loadProducts();
    }
  }

  async function handleStatusChange(order, newStatus) {
    const result = await storeUpdateOrder(branchUuid, order.uuid, { status: newStatus });
    if (result.success) {
      loadOrders();
    }
  }

  async function handleCancelOrder(order) {
    if (!window.confirm(`Cancel order ${order.orderNumber}?`)) return;
    const result = await storeCancelOrder(branchUuid, order.uuid);
    if (result.success) {
      loadOrders();
    }
  }

  function fmt(n) {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(n) || 0);
  }

  function statusBadge(status) {
    const colors = {
      PENDING: "#f59e0b", CONFIRMED: "#3b82f6", PROCESSING: "#8b5cf6",
      PACKED: "#ec4899", SHIPPED: "#0ea5e9", OUT_FOR_DELIVERY: "#f97316",
      DELIVERED: "#22c55e", CANCELLED: "#ef4444",
    };
    return (
      <span className="sf-variant-chip" style={{ background: colors[status] || "#666", color: "#fff" }}>
        {status.replace(/_/g, " ")}
      </span>
    );
  }

  function statView(label, value, sub, color = "#6b7280") {
    return (
      <div className="view-box">
        <span className="view-box-label">{label}</span>
        <span className="view-box-value" style={{ color }}>{value}</span>
        {sub && <span className="input-hint">{sub}</span>}
      </div>
    );
  }

  function navigateTab(key) {
    setTab(key);
    setProductPage(1);
    setOrderPage(1);
  }

  if (!branchUuid) {
    return (
      <div className="admin-shell">
        <StoreSidebar active={tab} onNavigate={navigateTab} branchName={branch?.name} />
        <main className="admin-main">
          <div className="filament-empty"><div className="filament-spinner" /></div>
        </main>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <StoreSidebar active={tab} onNavigate={navigateTab} branchName={branch?.name} />

      <main className="admin-main">
        <div className="filament-page">
          <div className="filament-card-header" style={{ padding: "0 0 1.25rem", borderBottom: "none" }}>
            <div className="filament-card-header-left">
              <h1>{branch?.name}</h1>
              <span className="filament-card-subtitle">
                {tab === "dashboard" && "Store overview · orders, revenue and stock health"}
                {tab === "products" && "Selling price and stock managed per store"}
                {tab === "orders" && "Orders placed against this store"}
                {tab === "settings" && "Store profile, location, hours and services"}
              </span>
            </div>
            {branches.length > 1 && (
              <div className="filament-card-header-right">
                <label className="input-hint" style={{ marginRight: 8 }}>Store</label>
                <select className="filament-select" value={branchUuid} onChange={(e) => setBranchId(e.target.value)}>
                  {branches.map((b) => (
                    <option key={b.uuid} value={b.uuid}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {tab !== "settings" && loading && <div className="filament-empty"><div className="filament-spinner" /></div>}

          {!loading && tab === "dashboard" && dashboard && (
            <>
              <div className="view-grid" style={{ marginBottom: 24 }}>
                {statView("Total Orders", dashboard.totalOrders, "All time")}
                {statView("Revenue", fmt(dashboard.revenue), "Selling price")}
                {statView("Pending", dashboard.pending, "Awaiting action", "#f59e0b")}
                {statView("Delivered", dashboard.delivered, "Completed", "#22c55e")}
              </div>

              <div className="filament-card">
                <div className="filament-card-header">
                  <div className="filament-card-header-left">
                    <h1>Low Stock Alerts</h1>
                    <span className="filament-card-subtitle">Products at or below their restock threshold</span>
                  </div>
                </div>
                {dashboard.lowStock && dashboard.lowStock.length > 0 ? (
                  <div className="variant-table-wrap">
                    <table className="variant-edit-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>SKU</th>
                          <th>Stock</th>
                          <th>Alert</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.lowStock.map((p) => (
                          <tr key={p.uuid}>
                            <td>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                                <img
                                  src={p.images?.[0] || "/media/default.jpg"}
                                  alt={p.name}
                                  loading="lazy"
                                  style={{ width: 34, height: 34, borderRadius: 6, objectFit: "cover" }}
                                />
                                <span className="sf-name">{p.name}</span>
                              </span>
                            </td>
                            <td>{p.sku}</td>
                            <td><span className="stock-badge-low">{p.stockQuantity}</span></td>
                            <td><span className="stock-badge-low">Low Stock</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="input-hint" style={{ padding: "0.75rem 1.25rem" }}>No low stock alerts</p>
                )}
              </div>
            </>
          )}

          {!loading && tab === "products" && (
            <div className="filament-card">
              <div className="filament-card-header">
                <div className="filament-card-header-left">
                  <h1>Products</h1>
                  <span className="filament-card-subtitle">{productTotal} product(s) in this store</span>
                </div>
              </div>
              <div className="variant-table-wrap">
                <table className="variant-edit-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>SKU</th>
                      <th>Category</th>
                      <th>Price</th>
                      <th>Stock</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <Fragment key={p.uuid}>
                        <tr>
                          <td>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                              <img
                                src={p.images?.[0] || "/media/default.jpg"}
                                alt={p.name}
                                loading="lazy"
                                style={{ width: 34, height: 34, borderRadius: 6, objectFit: "cover" }}
                              />
                              <span className="sf-name">{p.name}</span>
                            </span>
                          </td>
                          <td><code>{p.sku}</code></td>
                          <td>{p.category_name || "—"}</td>
                          <td>
                            {fmt(p.sellingPrice)}
                            {p.lowStockThreshold !== undefined && p.stockQuantity <= p.lowStockThreshold && (
                              <br />
                            )}
                          </td>
                          <td>
                            <span className={p.stockQuantity <= (p.lowStockThreshold ?? 0) ? "stock-badge-low" : "stock-badge-ok"}>
                              {p.stockQuantity}
                            </span>
                          </td>
                          <td>
                            {editingProduct?.uuid === p.uuid ? (
                              <button className="filament-btn filament-btn-outline" onClick={() => setEditingProduct(null)}>Cancel</button>
                            ) : (
                              <button
                                  className="filament-btn filament-btn-outline"
                                  onClick={() => {
                                    setEditingProduct(p);
                                    setEditPrice(p.sellingPrice);
                                    setEditCompareAt(p.compareAtPrice ?? "");
                                    setEditStock(p.stockQuantity);
                                    setEditLowStock(p.lowStockThreshold);
                                  }}
                                >Edit</button>
                            )}
                          </td>
                        </tr>
                        {editingProduct?.uuid === p.uuid && (
                          <tr style={{ background: "var(--surface-2)" }}>
                            <td colSpan={6}>
                              <div className="store-edit-row">
                                <label className="form-row">
                                  <span className="input-hint">Selling price</span>
                                  <input type="number" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
                                </label>
                                <label className="form-row">
                                  <span className="input-hint">Compare at</span>
                                  <input type="number" value={editCompareAt} onChange={(e) => setEditCompareAt(e.target.value)} />
                                </label>
                                <label className="form-row">
                                  <span className="input-hint">Stock</span>
                                  <input type="number" value={editStock} onChange={(e) => setEditStock(e.target.value)} />
                                </label>
                                <label className="form-row">
                                  <span className="input-hint">Low stock at</span>
                                  <input type="number" value={editLowStock} onChange={(e) => setEditLowStock(e.target.value)} />
                                </label>
                                <button className="filament-btn filament-btn-primary" onClick={() => handleUpdateProduct(p)}>Save</button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              {productTotal > 20 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, padding: "0.75rem 1.25rem" }}>
                  <button className="filament-btn filament-btn-outline" disabled={productPage <= 1} onClick={() => setProductPage((p) => p - 1)}>Prev</button>
                  <span className="input-hint">Page {productPage} of {Math.ceil(productTotal / 20)}</span>
                  <button className="filament-btn filament-btn-outline" disabled={productPage >= Math.ceil(productTotal / 20)} onClick={() => setProductPage((p) => p + 1)}>Next</button>
                </div>
              )}
            </div>
          )}

          {!loading && tab === "orders" && (
            <div className="filament-card">
              <div className="filament-card-header">
                <div className="filament-card-header-left">
                  <h1>Orders</h1>
                  <span className="filament-card-subtitle">{orderTotal} order(s) for this store</span>
                </div>
                <div className="filament-card-filters">
                  <div className="filament-search">
                    <FiSearch className="filament-search-icon" aria-hidden="true" />
                    <input
                      type="text"
                      placeholder="Search orders…"
                      value={orderSearch}
                      onChange={(e) => setOrderSearch(e.target.value)}
                    />
                  </div>
                  <select className="filament-select" value={orderStatusFilter} onChange={(e) => setOrderStatusFilter(e.target.value)}>
                    <option value="">All Status</option>
                    {["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"].map((s) => (
                      <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="variant-table-wrap">
                <table className="variant-edit-table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th>Total</th>
                      <th>Payment</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.uuid}>
                        <td><code>{o.orderNumber}</code></td>
                        <td>
                          <span className="sf-name">{o.customerName || "—"}</span>
                          <br />
                          <span className="sf-cat">{o.itemCount} item(s)</span>
                        </td>
                        <td>{fmt(Number(o.total))}</td>
                        <td>
                          <span className="sf-cat">{o.paymentMethod?.toUpperCase()}</span>
                          <br />
                          <span className="sf-cat">{o.paymentStatus}</span>
                        </td>
                        <td>{statusBadge(o.status)}</td>
                        <td>
                          {o.status !== "DELIVERED" && o.status !== "CANCELLED" && (
                            <>
                              {o.status === "PENDING" && (
                                <button className="filament-btn filament-btn-primary" onClick={() => handleStatusChange(o, "CONFIRMED")}>Accept</button>
                              )}
                              {o.status === "CONFIRMED" && (
                                <button className="filament-btn filament-btn-outline" onClick={() => handleStatusChange(o, "PROCESSING")}>Process</button>
                              )}
                              {o.status === "PROCESSING" && (
                                <button className="filament-btn filament-btn-outline" onClick={() => handleStatusChange(o, "PACKED")}>Pack</button>
                              )}
                              {o.status === "PACKED" && (
                                <button className="filament-btn filament-btn-outline" onClick={() => handleStatusChange(o, "SHIPPED")}>Ship</button>
                              )}
                              {o.status === "SHIPPED" && (
                                <button className="filament-btn filament-btn-outline" onClick={() => handleStatusChange(o, "OUT_FOR_DELIVERY")}>Dispatch</button>
                              )}
                              {o.status === "OUT_FOR_DELIVERY" && (
                                <button className="filament-btn filament-btn-outline" onClick={() => handleStatusChange(o, "DELIVERED")}>Delivered</button>
                              )}
                              <button className="filament-btn filament-btn-outline" style={{ marginLeft: 6, color: "#ef4444", borderColor: "#ef4444" }} onClick={() => handleCancelOrder(o)}>Cancel</button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {orderTotal > 20 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, padding: "0.75rem 1.25rem" }}>
                  <button className="filament-btn filament-btn-outline" disabled={orderPage <= 1} onClick={() => setOrderPage((p) => p - 1)}>Prev</button>
                  <span className="input-hint">Page {orderPage} of {Math.ceil(orderTotal / 20)}</span>
                  <button className="filament-btn filament-btn-outline" disabled={orderPage >= Math.ceil(orderTotal / 20)} onClick={() => setOrderPage((p) => p + 1)}>Next</button>
                </div>
              )}
            </div>
          )}

          {tab === "settings" && <StoreOnboarding mode="edit" />}
        </div>
      </main>
    </div>
  );
}