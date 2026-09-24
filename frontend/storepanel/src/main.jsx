import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";

import { AuthProvider, useAuth } from "../../src/context/AuthContext.jsx";
import Login from "../../src/pages/Login.jsx";
import ForgotPassword from "../../src/pages/ForgotPassword.jsx";
import StorePanel from "../../src/pages/StorePanel.jsx";
import StoreOnboarding from "../../src/pages/StoreOnboarding.jsx";
import StoreRegister from "../../src/pages/StoreRegister.jsx";

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
          This account is not linked to any store. Register a store, or switch
          to an account that manages one.
        </p>
        <Link className="store-panel-link" to="/register/store">
          Register a store
        </Link>
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
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/register/store" element={<StoreRegister />} />
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