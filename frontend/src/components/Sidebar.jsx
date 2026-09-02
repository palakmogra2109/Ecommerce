import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const MODULES = [
  {
    slug: "dashboard",
    path: "/dashboard",
    label: "Dashboard",
  },
  {
    slug: "users",
    path: "/users",
    label: "Users",
  },
  {
    slug: "roles",
    path: "/roles",
    label: "Roles",
  },
  {
    slug: "products",
    path: "/products",
    label: "Products",
  },
  {
    slug: "orders",
    path: "/orders",
    label: "Orders",
  },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    const data = await logout();

    if (data.success) {
      navigate("/");
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">E‑Commerce</div>

      <nav className="sidebar-nav">
        {MODULES.map((module) => (
          <NavLink
            key={module.slug}
            to={module.path}
            className={({ isActive }) =>
              isActive ? "sidebar-link active" : "sidebar-link"
            }
          >
            {module.label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <p className="sidebar-user">{user?.email ?? ""}</p>
        <button
          type="button"
          className="sidebar-logout"
          onClick={handleLogout}
        >
          Logout
        </button>
      </div>
    </aside>
  );
}