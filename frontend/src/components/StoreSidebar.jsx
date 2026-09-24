import { FiBox, FiLogOut, FiSettings, FiShoppingCart, FiTrendingUp } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const STORE_NAV = [
  { key: "dashboard", label: "Dashboard", icon: FiTrendingUp },
  { key: "products", label: "Products", icon: FiBox },
  { key: "orders", label: "Orders", icon: FiShoppingCart },
  { key: "settings", label: "Settings", icon: FiSettings },
];

export default function StoreSidebar({ active, onNavigate, branchName }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">Earth धान्य</div>

      <nav className="sidebar-nav">
        {STORE_NAV.map((item) => {
          const Icon = item.icon;

          return (
            <button
              key={item.key}
              type="button"
              className={`sidebar-link sidebar-toggle${active === item.key ? " active" : ""}`}
              onClick={() => onNavigate(item.key)}
            >
              <span className="sidebar-label">
                <Icon className="sidebar-item-icon" aria-hidden="true" />
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <p className="sidebar-user">
          {branchName ? `${branchName} · ` : ""}
          {user?.email ?? ""}
        </p>
        <button
          type="button"
          className="sidebar-logout"
          onClick={() => {
            logout();
            navigate("/");
          }}
        >
          <FiLogOut className="sidebar-item-icon" aria-hidden="true" />
          Logout
        </button>
      </div>
    </aside>
  );
}