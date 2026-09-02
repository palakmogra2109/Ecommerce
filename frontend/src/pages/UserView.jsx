import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { getUser } from "../services/users";
import Avatar from "../components/Avatar";
import Breadcrumb from "../components/Breadcrumb";

export default function UserView() {
  const { id } = useParams();
  const navigate = useNavigate();

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
    <div className="admin-page">
      <Breadcrumb
        items={[
          { label: "Users", to: "/users" },
          { label: user ? (user.name || user.email) : "View User" },
        ]}
      />

      <div className="admin-header">
        <h1>User Details</h1>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => navigate("/users")}
        >
          ← Back to Users
        </button>
      </div>

      {loading ? (
        <p className="admin-empty">Loading...</p>
      ) : message ? (
        <p className="form-message">{message}</p>
      ) : (
        <div className="view-card">
          <div className="view-card-head">
            <Avatar user={user} size={72} />
            <div>
              <h2>{user.name || "—"}</h2>
              <p>{user.email}</p>
            </div>
          </div>

          <dl className="view-card-fields">
            <div>
              <dt>User ID</dt>
              <dd>{user.id}</dd>
            </div>
            <div>
              <dt>Mobile</dt>
              <dd>{user.mobile || "—"}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{user.role?.name || "—"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <span
                  className={`status-badge status-${user.status.toLowerCase()}`}
                >
                  {user.status}
                </span>
              </dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>
                {new Date(user.created_at).toLocaleString()}
              </dd>
            </div>
          </dl>

          <div className="view-card-actions">
            <Link
              className="btn-secondary"
              to={`/users/${user.id}/edit`}
            >
              Edit User
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}