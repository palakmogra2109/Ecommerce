import { Navigate, Route, Routes, useParams } from "react-router-dom";

import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Users from "./pages/Users";
import UserView from "./pages/UserView";
import UserForm from "./components/UserForm";
import Roles from "./pages/Roles";
import RoleForm from "./components/RoleForm";
import EmailTemplates from "./pages/EmailTemplates";
import EmailTemplateForm from "./components/EmailTemplateForm";
import Products from "./pages/Products";
import Orders from "./pages/Orders";
import Settings from "./pages/Settings";
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

function EmailTemplateEditRoute() {
  const { id } = useParams();
  return <EmailTemplateForm templateId={Number(id)} />;
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

        {/* /email-templates → Email template management */}
        <Route
          path="/email-templates"
          element={<EmailTemplates />}
        />
<Route
          path="/email-templates/:id/edit"
          element={<EmailTemplateEditRoute />}
        />

        {/* /products → Product listing */}
        <Route path="/products" element={<Products />} />

        {/* /orders → Order listing */}
        <Route path="/orders" element={<Orders />} />

        {/* /settings → Global settings + theme */}
        <Route path="/settings" element={<Settings />} />
      </Route>

      {/* Unknown URL → root */}
      <Route
        path="*"
        element={<Navigate to="/" replace />}
      />
    </Routes>
  );
}