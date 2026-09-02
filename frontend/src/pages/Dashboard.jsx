import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Dashboard() {
  const { user, logout } = useAuth();

  const navigate = useNavigate();

  async function handleLogout() {
    const data = await logout();

    if (data.success) {
      navigate("/login");
    }
  }

  return (
    <div className="dashboard">
      <h1>Dashboard</h1>

      <div>
        <h2>
          Welcome, {user?.name}
        </h2>

        <p>
          Email: {user?.email}
        </p>

        <p>
          User ID: {user?.id}
        </p>
      </div>

      <button onClick={handleLogout}>
        Logout
      </button>

      <div style={{ marginTop: "20px" }}>
        <p>
          <Link to="/users">Manage Users</Link>
        </p>
        <p>
          <Link to="/roles">Manage Roles</Link>
        </p>
        <p>
          <Link to="/permissions">Manage Permissions</Link>
        </p>
      </div>
    </div>
  );
}