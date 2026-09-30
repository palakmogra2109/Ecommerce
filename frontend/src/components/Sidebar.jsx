import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  FiBox,
  FiChevronDown,
  FiFileText,
  FiGrid,
  FiImage,
  FiInbox,
  FiLayout,
  FiLogOut,
  FiGift,
  FiMail,
  FiPercent,
  FiSettings,
  FiShoppingBag,
  FiShoppingCart,
  FiStar,
  FiTag,
  FiTruck,
  FiUsers,
  FiUserCheck,
} from "react-icons/fi";
import { useAuth } from "../context/AuthContext";

// Permission slug that grants access to each sidebar module.
const MODULE_VIEW_PERMISSIONS = {
  dashboard: "dashboard.view",
  users: "users.view",
  roles: "roles.view",
  email_templates: "email_templates.view",
  products: "products.view",
  categories: "categories.view",
  sub_categories: "categories.view",
  brands: "brands.view",
  attributes: "attributes.view",
  inventory: "products.view",
  orders: "orders.view",
  customers: "customers.view",
  coupons: "coupons.view",
  gift_cards: "gift_cards.view",
  reviews: "reviews.view",
  banners: "banners.view",
  settings: "settings.view",
  branches: "branches.view",
  branches_orders: "branches.orders.view",
  stores: "branches.view",
  manager_dashboard: "store_dashboard.view",
  manager_products: "store_products.view",
  manager_orders: "store_orders.view",
};

const MODULES = [
  {
    slug: "dashboard",
    path: "/dashboard",
    label: "Dashboard",
    icon: FiLayout,
  },
  {
    slug: "users",
    path: "/users",
    label: "Users",
    icon: FiUsers,
  },
  {
    slug: "roles",
    path: "/roles",
    label: "Roles",
    icon: FiUserCheck,
  },
  {
    slug: "email_templates",
    path: "/email-templates",
    label: "Email Templates",
    icon: FiMail,
  },
  {
    slug: "product_management",
    label: "Products",
    icon: FiShoppingBag,
    children: [
      {
        slug: "products",
        path: "/products",
        label: "All Products",
        icon: FiBox,
      },
      {
        slug: "categories",
        path: "/categories",
        label: "Categories",
        icon: FiGrid,
      },
      {
        slug: "sub_categories",
        path: "/sub-categories",
        label: "Sub Categories",
        icon: FiGrid,
      },
      {
        slug: "brands",
        path: "/brands",
        label: "Brands",
        icon: FiTag,
      },
      {
        slug: "attributes",
        path: "/attributes",
        label: "Attributes",
        icon: FiFileText,
      },
      {
        slug: "inventory",
        path: "/inventory",
        label: "Stock & Price",
        icon: FiTruck,
      },
    ],
  },
  {
    slug: "orders",
    path: "/orders",
    label: "Orders",
    icon: FiShoppingCart,
  },
  {
    slug: "customers",
    path: "/customers",
    label: "Customers",
    icon: FiUsers,
  },
  {
    slug: "coupons",
    path: "/coupons",
    label: "Coupons",
    icon: FiPercent,
  },
  {
    slug: "gift_cards",
    path: "/gift-cards",
    label: "Gift Cards",
    icon: FiGift,
  },
  {
    slug: "reviews",
    path: "/reviews",
    label: "Reviews",
    icon: FiStar,
  },
  {
    slug: "banners",
    path: "/banners",
    label: "Banners",
    icon: FiImage,
  },
  {
    slug: "settings",
    path: "/settings",
    label: "Settings",
    icon: FiSettings,
  },
  {
    slug: "stores",
    path: "/branches/stores",
    label: "Stores",
    icon: FiShoppingBag,
  },
  {
    slug: "manager_dashboard",
    path: "/manager",
    label: "My Store",
    icon: FiInbox,
   },
];

function SidebarGroup({ module, pathname }) {
  const isActive = module.children.some(
    (child) => pathname === child.path || pathname.startsWith(`${child.path}/`)
  );
  const [isOpen, setIsOpen] = useState(isActive);
  const submenuId = `sidebar-${module.slug}`;
  const Icon = module.icon;
  const Chevron = FiChevronDown;

  return (
    <div className="sidebar-group">
      <button
        type="button"
        className={`sidebar-link sidebar-toggle${isActive ? " active" : ""}`}
        aria-expanded={isOpen}
        aria-controls={submenuId}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="sidebar-label">
          {Icon && <Icon className="sidebar-item-icon" aria-hidden="true" />}
          {module.label}
        </span>
        <Chevron className="sidebar-chevron" aria-hidden="true" />
      </button>
      <div id={submenuId} className="sidebar-submenu" hidden={!isOpen}>
        {module.children.map((child) => {
          const ChildIcon = child.icon;

          return (
            <NavLink
              key={child.slug}
              to={child.path}
              className={({ isActive }) =>
                isActive ? "sidebar-link active" : "sidebar-link"
              }
            >
              {ChildIcon && (
                <ChildIcon className="sidebar-item-icon" aria-hidden="true" />
              )}
              {child.label}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}

export default function Sidebar() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Non-super-admin users only see the modules their permissions allow.
  // Users with no permissions see no modules at all.
  const visibleModules = MODULES.map((module) => {
    if (module.children) {
      return {
        ...module,
        children: module.children.filter((child) =>
          can(MODULE_VIEW_PERMISSIONS[child.slug])
        ),
      };
    }

    return module;
  }).filter((module) =>
    module.children
      ? module.children.length > 0
      : can(MODULE_VIEW_PERMISSIONS[module.slug])
  );

  async function handleLogout() {
    const data = await logout();

    if (data.success) {
      navigate("/");
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">Earth धान्य</div>

      <nav className="sidebar-nav">
        {visibleModules.length === 0 ? (
          <p className="sidebar-empty">
            No modules are assigned to your account.
          </p>
        ) : (
          visibleModules.map((module) => {
            const Icon = module.icon;

            return module.children ? (
              <SidebarGroup
                key={`${module.slug}:${pathname}`}
                module={module}
                pathname={pathname}
              />
            ) : (
              <NavLink
                key={module.slug}
                to={module.path}
                className={({ isActive }) =>
                  isActive ? "sidebar-link active" : "sidebar-link"
                }
              >
                {Icon && (
                  <Icon className="sidebar-item-icon" aria-hidden="true" />
                )}
                <span className="sidebar-label">{module.label}</span>
              </NavLink>
            );
          })
        )}
      </nav>

      <div className="sidebar-footer">
        <p className="sidebar-user">{user?.email ?? ""}</p>
        <button
          type="button"
          className="sidebar-logout"
          onClick={handleLogout}
        >
          <FiLogOut className="sidebar-item-icon" aria-hidden="true" />
          Logout
        </button>
      </div>
    </aside>
  );
}