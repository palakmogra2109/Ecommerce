import { Link } from "react-router-dom";

import Breadcrumb from "../components/Breadcrumb";

/*
 * 404 page for unknown URLs inside the admin panel. Renders inside
 * AdminLayout via App.jsx so the sidebar and topbar stay visible.
 */
export default function NotFound() {
  return (
    <>
      <Breadcrumb
        items={[{ label: "Home", to: "/dashboard" }, { label: "404" }]}
      />

      <div className="notfound-page">
        <p className="notfound-code">404</p>
        <h1>Page not found</h1>
        <p className="notfound-text">
          The page you are looking for doesn't exist, was moved, or you don't
          have access to it.
        </p>
        <div className="notfound-actions">
          <Link to="/dashboard" className="filament-btn filament-btn-primary">
            Go to dashboard
          </Link>
          <button
            type="button"
            className="filament-btn filament-btn-outline"
            onClick={() => window.history.back()}
          >
            Go back
          </button>
        </div>
      </div>
    </>
  );
}
