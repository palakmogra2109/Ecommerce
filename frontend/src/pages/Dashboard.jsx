import { useAuth } from "../context/AuthContext";

export default function Dashboard() {
  const { user } = useAuth();

  return (
    <div className="dashboard">
      <h1>Dashboard</h1>

      <div>
        <h2>Welcome, {user?.name}</h2>

        <p>Email: {user?.email}</p>
        <p>User ID: {user?.uuid}</p>
      </div>

      <div>
        <h3>Your Roles</h3>
        <p>{(user?.roles ?? []).join(", ") || "No roles assigned"}</p>
      </div>
    </div>
  );
}