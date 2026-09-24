import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { storeDashboard, storeProducts, storeOrders, storeUpdateOrder } from "../services/store";
import StoreOnboarding from "./StoreOnboarding";
import { FiBox, FiShoppingCart, FiTrendingUp, FiCheckCircle, FiClock, FiSettings } from "react-icons/fi";

export default function StorePanel() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
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
      navigate("/");
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

  if (!branchUuid) {
    return <div className="auth-page"><div className="auth-card"><h2>Loading...</h2></div></div>;
  }

  return (
    <div className="store-panel">
      <div className="store-header">
        <div className="store-header-left">
          <h1>{branch?.name || "Store Manager"}</h1>
          {branches.length > 1 && (
            <select className="store-branch-select" value={branchUuid} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => (
                <option key={b.uuid} value={b.uuid}>{b.name}</option>
              ))}
            </select>
          )}
        </div>
        <button className="sf-btn ghost" onClick={() => { logout(); navigate("/"); }}>Logout</button>
      </div>

      <div className="store-tabs">
        {[
          { key: "dashboard", label: "Dashboard", icon: FiTrendingUp },
          { key: "products", label: "Products", icon: FiBox },
          { key: "orders", label: "Orders", icon: FiShoppingCart },
          { key: "settings", label: "Settings", icon: FiSettings },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              className={`store-tab${tab === t.key ? " active" : ""}`}
              onClick={() => { setTab(t.key); setProductPage(1); setOrderPage(1); }}
            >
              <Icon /> {t.label}
            </button>
          );
        })}
      </div>

      {tab !== "settings" && loading && <p className="store-loading">Loading...</p>}

      {tab === "dashboard" && dashboard && (
        <div className="store-dashboard">
          <div className="store-stats">
            <div className="stat-card">
              <FiShoppingCart className="stat-icon" />
              <div className="stat-value">{dashboard.totalOrders}</div>
              <div className="stat-label">Total Orders</div>
            </div>
            <div className="stat-card">
              <FiTrendingUp className="stat-icon" />
              <div className="stat-value">{fmt(dashboard.revenue)}</div>
              <div className="stat-label">Revenue</div>
            </div>
            <div className="stat-card">
              <FiClock className="stat-icon" />
              <div className="stat-value">{dashboard.pending}</div>
              <div className="stat-label">Pending</div>
            </div>
            <div className="stat-card">
              <FiCheckCircle className="stat-icon" />
              <div className="stat-value">{dashboard.delivered}</div>
              <div className="stat-label">Delivered</div>
            </div>
          </div>
          <h2>Low Stock Alerts</h2>
          {dashboard.lowStock && dashboard.lowStock.length > 0 ? (
            <div className="store-product-list">
              {dashboard.lowStock.map((p) => (
                <div key={p.uuid} className="store-product-card">
                  <img src={p.images?.[0] || "/media/default.jpg"} alt={p.name} loading="lazy" />
                  <div className="store-product-info">
                    <div className="sf-name">{p.name}</div>
                    <div className="sf-cat">{p.sku} — Stock: {p.stockQuantity}</div>
                    <span className="sf-variant-chip" style={{ background: "#ef4444" }}>Low Stock</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p>No low stock alerts</p>
          )}
        </div>
      )}

      {tab === "products" && (
        <div className="store-products">
          <h2>Your Products</h2>
          <div className="store-product-list">
            {products.map((p) => (
              <div key={p.uuid} className="store-product-card">
                <img src={p.images?.[0] || "/media/default.jpg"} alt={p.name} loading="lazy" />
                <div className="store-product-info">
                  <div className="sf-name">{p.name}</div>
                  <div className="sf-cat">{p.sku} — {p.category_name}</div>
                  <div className="store-product-price">{fmt(p.sellingPrice)}</div>
                  <div className="store-product-stock">Stock: {p.stockQuantity} {p.lowStockThreshold ? `(low: ${p.lowStockThreshold})` : ""}</div>
                  {editingProduct?.uuid === p.uuid ? (
                    <div className="store-edit-form">
                      <input type="number" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} placeholder="Price" />
                      <input type="number" value={editCompareAt} onChange={(e) => setEditCompareAt(e.target.value)} placeholder="Compare at" />
                      <input type="number" value={editStock} onChange={(e) => setEditStock(e.target.value)} placeholder="Stock" />
                      <input type="number" value={editLowStock} onChange={(e) => setEditLowStock(e.target.value)} placeholder="Low stock at" />
                      <button className="sf-btn primary" onClick={() => handleUpdateProduct(p)}>Save</button>
                      <button className="sf-btn ghost" onClick={() => setEditingProduct(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="sf-btn primary" onClick={() => { setEditingProduct(p); setEditPrice(p.sellingPrice); setEditCompareAt(p.compareAtPrice ?? ""); setEditStock(p.stockQuantity); setEditLowStock(p.lowStockThreshold); }}>Edit</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {productTotal > 20 && (
            <div className="store-pagination">
              <button disabled={productPage <= 1} onClick={() => setProductPage((p) => p - 1)}>Prev</button>
              <span>Page {productPage} of {Math.ceil(productTotal / 20)}</span>
              <button disabled={productPage >= Math.ceil(productTotal / 20)} onClick={() => setProductPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}

      {tab === "orders" && (
        <div className="store-orders">
          <h2>Orders</h2>
          <div className="store-orders-filters">
            <input type="text" placeholder="Search orders..." value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} />
            <select value={orderStatusFilter} onChange={(e) => setOrderStatusFilter(e.target.value)}>
              <option value="">All Status</option>
              {["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"].map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div className="store-order-list">
            {orders.map((o) => (
              <div key={o.uuid} className="store-order-card">
                <div className="store-order-header">
                  <span className="sf-name">{o.orderNumber}</span>
                  {statusBadge(o.status)}
                </div>
                <div className="store-order-body">
                  <div>{o.customerName} — {fmt(Number(o.total))}</div>
                  <div className="sf-cat">{o.itemCount} item(s) · {o.paymentMethod?.toUpperCase()} · {o.paymentStatus}</div>
                </div>
                <div className="store-order-actions">
                  {o.status !== "DELIVERED" && o.status !== "CANCELLED" && (
                    <>
                      {o.status === "PENDING" && (
                        <button className="sf-btn primary" onClick={() => handleStatusChange(o, "CONFIRMED")}>Accept</button>
                      )}
                      {o.status === "CONFIRMED" && (
                        <button className="sf-btn primary" onClick={() => handleStatusChange(o, "PROCESSING")}>Process</button>
                      )}
                      {o.status === "PROCESSING" && (
                        <button className="sf-btn primary" onClick={() => handleStatusChange(o, "PACKED")}>Pack</button>
                      )}
                      {o.status === "PACKED" && (
                        <button className="sf-btn primary" onClick={() => handleStatusChange(o, "SHIPPED")}>Ship</button>
                      )}
                      {o.status === "SHIPPED" && (
                        <button className="sf-btn primary" onClick={() => handleStatusChange(o, "OUT_FOR_DELIVERY")}>Dispatch</button>
                      )}
                      {o.status === "OUT_FOR_DELIVERY" && (
                        <button className="sf-btn primary" onClick={() => handleStatusChange(o, "DELIVERED")}>Delivered</button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          {orderTotal > 20 && (
            <div className="store-pagination">
              <button disabled={orderPage <= 1} onClick={() => setOrderPage((p) => p - 1)}>Prev</button>
              <span>Page {orderPage} of {Math.ceil(orderTotal / 20)}</span>
              <button disabled={orderPage >= Math.ceil(orderTotal / 20)} onClick={() => setOrderPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}

      {tab === "settings" && <StoreOnboarding mode="edit" />}
    </div>
  );
}