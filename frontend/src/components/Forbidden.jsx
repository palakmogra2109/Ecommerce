import { FiHome, FiLock, FiLogOut } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Forbidden({
  required = "",
  permissionLabel = "this area",
}) {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const label =
    (user?.name && user.name.trim()) ||
    (user?.email && user.email.replace(/@.*$/, "")) ||
    "User";
  const canOpenDashboard = can("dashboard.view");

  async function handleLogout() {
    const data = await logout();

    if (data.success) {
      navigate("/");
    }
  }

  return (
    <div className="forbidden">
      <div className="forbidden-card">
        <div className="forbidden-icon-wrap">
          <FiLock className="forbidden-icon" aria-hidden="true" />
        </div>

        <div className="forbidden-code">403</div>
        <h1 className="forbidden-title">Access denied</h1>

        <p className="forbidden-message">
          Hi <strong>{label}</strong>, your account does not have the{" "}
          <strong>{permissionLabel || "required"}</strong> permission, so this
          page cannot be opened.
        </p>

        {required && (
          <div className="forbidden-required">
            Required permission:
            <code>{required}</code>
          </div>
        )}

        <div className="forbidden-actions">
          {canOpenDashboard && (
            <button
              type="button"
              className="forbidden-btn forbidden-btn-primary"
              onClick={() => navigate("/dashboard")}
            >
              <FiHome className="forbidden-btn-icon" aria-hidden="true" />
              Go to Dashboard
            </button>
          )}
          <button
            type="button"
            className={`forbidden-btn ${canOpenDashboard ? "forbidden-btn-ghost" : "forbidden-btn-primary"}`}
            onClick={handleLogout}
          >
            <FiLogOut className="forbidden-btn-icon" aria-hidden="true" />
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}