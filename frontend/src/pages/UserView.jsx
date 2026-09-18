import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { getUser } from "../services/users";
import Avatar from "../components/Avatar";
import Breadcrumb from "../components/Breadcrumb";
import { useAuth } from "../context/AuthContext";
import { formatDateTime } from "../utils/format";

export default function UserView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const data = await getUser(id);

        if (!active) {
          return;
        }

        if (data.success) {
          setUser(data.user);
        } else {
          setMessage(data.message);
        }
      } catch {
        if (!active) {
          return;
        }

        setMessage(
          "Unable to connect to the server. Please try again."
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      active = false;
    };
  }, [id]);

  return (
    <div className="filament-page">
      <Breadcrumb
        items={[
          { label: "Users", to: "/users" },
          { label: user ? user.name || user.email : "View User" },
        ]}
      />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>User Details</h1>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button"
              className="filament-btn filament-btn-outline"
              onClick={() => navigate("/users")}
            >
              ← Back to Users
            </button>
          </div>
        </div>

        {loading ? (
          <div className="filament-empty">
            <div className="filament-spinner" />
          </div>
        ) : !user ? (
          <div className="filament-empty">
            <p>User not found.</p>
          </div>
        ) : (
          <div className="view-body">
            <div className="view-head">
              <Avatar user={user} size={72} />
              <div>
                <h2>{user.name || "—"}</h2>
                <p>{user.email}</p>
              </div>
            </div>

            <div className="view-grid">
              <div className="view-box">
                <span className="view-box-label">User ID</span>
                <span className="view-box-value">{user.uuid}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Email</span>
                <span className="view-box-value">{user.email || "—"}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Mobile</span>
                <span className="view-box-value">{user.mobile || "—"}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Role</span>
                <span className="view-box-value">{user.role?.name || "—"}</span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Status</span>
                <span className="view-box-value">
                  <span
                    className={`filament-badge filament-badge-${(user.status || "inactive").toLowerCase()}`}
                  >
                    <span className="filament-badge-dot" />
                    {user.status}
                  </span>
                </span>
              </div>
              <div className="view-box">
                <span className="view-box-label">Created</span>
                <span className="view-box-value">
                  {formatDateTime(user.created_at)}
                </span>
              </div>
            </div>

            <div className="view-actions">
              {can("users.update") && (
              <Link
                className="filament-btn filament-btn-primary"
                to={`/users/${user.uuid}/edit`}
              >
                Edit User
              </Link>
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}