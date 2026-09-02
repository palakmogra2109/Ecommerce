import { Navigate, Route, Routes, useParams } from "react-router-dom";

import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Users from "./pages/Users";
import UserView from "./pages/UserView";
import UserForm from "./components/UserForm";
import Roles from "./pages/Roles";
import RoleForm from "./components/RoleForm";
import Products from "./pages/Products";
import Orders from "./pages/Orders";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import ProtectedRoute from "./components/ProtectedRoute";
import PublicRoute from "./components/PublicRoute";
import AdminLayout from "./components/AdminLayout";

function UserEditRoute() {
  const { id } = useParams();
  return <UserForm userId={Number(id)} />;
}

function RoleEditRoute() {
  const { id } = useParams();
  return <RoleForm roleId={Number(id)} />;
}

export default function App() {
  return (
    <Routes>
      {/* Root → Login if logged out */}
      <Route
        path="/"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />

      {/* /login → Login if logged out */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />

      {/* /register → Register if logged out */}
      <Route
        path="/register"
        element={
          <PublicRoute>
            <Register />
          </PublicRoute>
        }
      />

      {/* /forgot-password → ForgotPassword if logged out */}
      <Route
        path="/forgot-password"
        element={
          <PublicRoute>
            <ForgotPassword />
          </PublicRoute>
        }
      />

      <Route
        path="/reset-password"
        element={
          <PublicRoute>
            <ResetPassword />
          </PublicRoute>
        }
      />

      {/* Everything below requires login + shows the sidebar */}
      <Route
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        {/* /dashboard → Dashboard */}
        <Route path="/dashboard" element={<Dashboard />} />

        {/* /users → User management */}
        <Route path="/users" element={<Users />} />
        <Route path="/users/new" element={<UserForm />} />
        <Route path="/users/:id" element={<UserView />} />
        <Route path="/users/:id/edit" element={<UserEditRoute />} />

        {/* /roles → Role management */}
        <Route path="/roles" element={<Roles />} />
        <Route path="/roles/new" element={<RoleForm />} />
        <Route path="/roles/:id/edit" element={<RoleEditRoute />} />

        {/* /products → Product listing */}
        <Route path="/products" element={<Products />} />

        {/* /orders → Order listing */}
        <Route path="/orders" element={<Orders />} />
      </Route>

      {/* Unknown URL → root */}
      <Route
        path="*"
        element={<Navigate to="/" replace />}
      />
    </Routes>
  );
}