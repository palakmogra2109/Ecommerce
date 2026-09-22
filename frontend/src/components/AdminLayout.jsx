import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";

export default function AdminLayout({ children }) {
  return (
    <div className="admin-shell">
      <Sidebar />

      <main className="admin-main">
        {children ?? <Outlet />}
      </main>
    </div>
  );
}