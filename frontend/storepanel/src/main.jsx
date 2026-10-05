import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";

import { AuthProvider, useAuth } from "../../src/context/AuthContext.jsx";
import Login from "../../src/pages/Login.jsx";
import ForgotPassword from "../../src/pages/ForgotPassword.jsx";
import StorePanel from "../../src/pages/StorePanel.jsx";
import StoreOnboarding from "../../src/pages/StoreOnboarding.jsx";

import "../../src/index.css";

function Home() {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.branches?.length) {
    return <Navigate to="/no-store" replace />;
  }

  return <Navigate to="/manager" replace />;
}

function NoStore() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="auth-container">
      <div className="auth-form">
        <h1>No store linked</h1>
        <p>
          This account is not linked to any store. Store accounts are set up by
          an administrator, who creates the user with the store role and then
          links the branch. Once that is done, sign in again.
        </p>
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate("/login");
          }}
        >
          Switch account
        </button>
      </div>
    </div>
  );
}

function App() {
  return (
    <Routes>
      {/* No /register/store here either. Self-signup created a branch and an
          account holding store_products.update and store_orders.update, for
          whoever reached the URL. Store accounts are provisioned by an admin:
          create the user with the "store" role in Users, then link the branch
          via /api/branches/[id]/users. */}
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/no-store" element={<NoStore />} />
      <Route path="/manager/onboarding" element={<StoreOnboarding />} />
      <Route path="/manager" element={<StorePanel />} />
      <Route path="/" element={<Home />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

const rootEl = document.getElementById("root");

createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);