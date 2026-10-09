import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { FiMenu } from "react-icons/fi";
import Sidebar from "./Sidebar";
import AdminTopbar from "./AdminTopbar";
import { useAuth } from "../context/AuthContext";

// Below this width the sidebar becomes an off-canvas drawer rather than a rail.
// Measured at 390px: a fixed 240px sidebar took 62% of the screen and left the
// content 150px, which is not a usable layout however the rest is styled.
export const MOBILE_BREAKPOINT = 768;

export default function AdminLayout({ children }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  async function handleLogout() {
    const data = await logout();
    if (data.success) navigate("/");
  }

  // Close on navigation, but WITHOUT an effect. The rule that fires here is
  // exactly right: a setState synchronously inside an effect starts another
  // render to do work that can be derived during this one.
  //
  // `pathname` is the signal that the route changed, and the drawer state
  // derived from it during render is the fix — keyed on the location, NOT on
  // `children`, which is undefined on every page when this renders <Outlet />.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (drawerOpen) setDrawerOpen(false);
  }

  // Escape closes, and the page behind must not scroll while it is open or the
  // content slides out from under the drawer.
  useEffect(() => {
    if (!drawerOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  return (
    <div className="admin-shell">
      <button
        type="button"
        className="admin-menu-btn"
        onClick={() => setDrawerOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={drawerOpen}
        aria-controls="admin-sidebar"
      >
        <FiMenu aria-hidden="true" />
      </button>

      {/* Scrim: a real button so it is reachable by keyboard and announced,
          rather than a div that only responds to a mouse. */}
      {drawerOpen && (
        <button
          type="button"
          className="admin-scrim"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close navigation menu"
        />
      )}

      <Sidebar id="admin-sidebar" open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <div className="admin-body">
        <AdminTopbar user={user} onLogout={handleLogout} />

        <main className="admin-main">
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}