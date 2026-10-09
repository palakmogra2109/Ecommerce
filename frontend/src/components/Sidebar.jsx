import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  FiBox,
  FiChevronDown,
  FiChevronLeft,
  FiChevronRight,
  FiFileText,
  FiGrid,
  FiImage,
  FiInbox,
  FiLayout,
  FiGift,
  FiMail,
  FiPercent,
  FiSettings,
  FiShoppingBag,
  FiShoppingCart,
  FiStar,
  FiTag,
  FiUsers,
  FiUserCheck,
  FiX,
} from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import SidebarProfileFooter from "./SidebarProfileFooter";
import SidebarTooltip from "./SidebarTooltip";

// Persisted collapse preference. Named with the sidebar_ prefix used elsewhere in
// the app for per-surface UI state (sf_view, sf_branch).
const COLLAPSE_KEY = "sidebar_collapsed";

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
  purchase_invoices: "purchase_invoices.view",
  suppliers: "suppliers.view",
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
      /*
       * Stock & Price is no longer offered in the navigation: purchase
       * invoices are the single flow for receiving stock and repricing
       * products. The /inventory page itself still works for admins who
       * reach it by URL.
       */
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
    slug: "purchase_management",
    label: "Purchases",
    icon: FiShoppingCart,
    children: [
      {
        slug: "suppliers",
        path: "/suppliers",
        label: "Suppliers",
        icon: FiUsers,
      },
      {
        slug: "purchase_invoices",
        path: "/purchase-invoices",
        label: "Purchase Invoices",
        icon: FiFileText,
      },
    ],
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

function SidebarGroup({ module, pathname, collapsed }) {
  const isActive = module.children.some(
    (child) => pathname === child.path || pathname.startsWith(`${child.path}/`)
  );
  const [isOpen, setIsOpen] = useState(isActive);

  // Where the collapsed flyout goes, in viewport coordinates.
  //
  // It has to be `position: fixed` and placed by hand. The obvious
  // `position: absolute; left: 100%` inside the rail does not work: .sidebar-nav
  // is a scroll container, and CSS gives a scrollable axis `overflow: auto` on
  // BOTH axes, so the rail clips the flyout to its own 64px width. Measured, it
  // hid 206px of a 200px panel — invisible while still reporting itself visible
  // to a visibility check. Fixed positioning escapes every ancestor clip.
  const [flyout, setFlyout] = useState(null);
  const groupRef = useRef(null);

  const openFlyout = () => {
    if (!collapsed) return;
    const group = groupRef.current;
    const rail = group?.closest(".sidebar");
    if (!group || !rail) return;

    const rect = group.getBoundingClientRect();
    const panel = 200;
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - panel - 16));
    // Overlaps the rail by 2px so there is no dead gap for the pointer to cross
    // between the icon and the panel it opened.
    setFlyout({ top, left: rail.getBoundingClientRect().right - 2 });
  };

  const closeFlyout = () => setFlyout(null);

  // A fixed panel does not travel with the content, so any scroll or resize
  // would leave it hanging over the wrong item. Closing is the honest response.
  useEffect(() => {
    if (flyout === null) return undefined;
    const dismiss = () => closeFlyout();
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyout]);

  const submenuId = `sidebar-${module.slug}`;
  const Icon = module.icon;
  const Chevron = FiChevronDown;

  return (
    <div
      className="sidebar-group"
      ref={groupRef}
      onMouseEnter={openFlyout}
      onMouseLeave={closeFlyout}
    >
      <SidebarTooltip label={collapsed ? module.label : null}>
      <button
        type="button"
        className={`sidebar-link sidebar-toggle${isActive ? " active" : ""}`}
        aria-expanded={collapsed ? undefined : isOpen}
        aria-controls={collapsed ? undefined : submenuId}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="sidebar-label">
          {Icon && <Icon className="sidebar-item-icon" aria-hidden="true" />}
          {/* Its own element so collapsing can hide the TEXT and keep the icon.
              As a bare text node beside the icon there is nothing to target. */}
          <span className="sidebar-label-text">{module.label}</span>
        </span>
        {/* Meaningless while collapsed: the submenu is a hover flyout there, not
            an accordion, so claiming expanded/collapsed would misdescribe it. */}
        {!collapsed && <Chevron className="sidebar-chevron" aria-hidden="true" />}
      </button>
      </SidebarTooltip>
      {/* While collapsed the rail is 64px wide, so an inline accordion has no
          room. `hidden` is dropped and the element becomes a hover flyout. */}
      <div
        id={submenuId}
        className="sidebar-submenu"
        hidden={!isOpen && !collapsed}
        style={collapsed && flyout ? { top: flyout.top, left: flyout.left } : undefined}
      >
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
              <span className="sidebar-label-text">{child.label}</span>
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}

export default function Sidebar({ id, open = false, onClose }) {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Persisted so the rail stays as the user left it. Read lazily so a reload
  // does not flash the full rail first, and stored as "1"/"0" rather than a
  // boolean string so the key is explicit about what it means.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === "1"
  );

  const toggleCollapsed = () => {
    setCollapsed((was) => {
      const next = !was;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };

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
    <aside
      id={id}
      className={`sidebar${collapsed ? " sidebar-collapsed" : ""}${open ? " sidebar-open" : ""}`}
    >
      <div className="sidebar-brand">
        <span className="sidebar-brand-text">Quick Kart</span>
        <button
          type="button"
          className="sidebar-drawer-close"
          onClick={onClose}
          aria-label="Close navigation menu"
          title="Close navigation menu"
        >
          <FiX aria-hidden="true" />
        </button>
        <button
          type="button"
          className="sidebar-collapse"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <FiChevronRight aria-hidden="true" /> : <FiChevronLeft aria-hidden="true" />}
        </button>
      </div>

      {/* tabIndex: the nav is now a scroll container, and a scroll container that
          cannot be focused cannot be scrolled with the keyboard. The label gives
          it an accessible name. */}
      <nav
        className="sidebar-nav"
        tabIndex={0}
        aria-label="Modules"
      >
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
                collapsed={collapsed}
              />
            ) : (
              <SidebarTooltip key={module.slug} label={collapsed ? module.label : null}>
                <NavLink
                  to={module.path}
                  className={({ isActive }) =>
                    isActive ? "sidebar-link active" : "sidebar-link"
                  }
                >
                  {/* Icon inside the label wrapper, matching the group toggle
                      below. When they differed, the collapsed rail had a
                      zero-width label span still collecting the 10px gap, which
                      pulled every icon 5px left of centre. */}
                  <span className="sidebar-label">
                    {Icon && (
                      <Icon className="sidebar-item-icon" aria-hidden="true" />
                    )}
                    <span className="sidebar-label-text">{module.label}</span>
                  </span>
                </NavLink>
              </SidebarTooltip>
            );
          })
        )}
      </nav>

      <SidebarProfileFooter user={user} collapsed={collapsed} onLogout={handleLogout} />
    </aside>
  );
}