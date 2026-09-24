import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { storeRegister } from "../services/store";
import { useAuth } from "../context/AuthContext";

export default function StoreRegister() {
  const navigate = useNavigate();
  const { login, getLandingPath } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    branchName: "",
    branchCode: "",
    city: "",
    address: "",
    phone: "",
  });

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!form.branchName.trim()) {
      setError("Store name is required");
      return;
    }
    setLoading(true);
    try {
      const data = await storeRegister(form);
      if (data.success) {
        // Backend now sets the auth cookie, so warm the session and
        // redirect into onboarding / the store panel.
        await login(form.email, form.password);
        navigate("/manager/onboarding", { replace: true });
      } else {
        setError(data.message || "Registration failed");
      }
    } catch (err) {
      setError("Something went wrong. Please try again.");
    }
    setLoading(false);
  }

  function nextStep() {
    setError("");
    if (step === 1 && form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (step === 1 && (!form.name.trim() || !form.email.trim() || !form.password)) {
      setError("Name, email and password are required");
      return;
    }
    setStep(2);
  }

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <div className="auth-container">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>{step === 1 ? "Create Account" : "Your Store"}</h1>

        {step === 1 && (
          <>
            <input
              type="text"
              placeholder="Full name"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              required
            />
            <input
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Password (min 6 characters)"
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              required
              minLength={6}
            />
            <input
              type="password"
              placeholder="Confirm password"
              value={form.confirmPassword}
              onChange={(e) => update("confirmPassword", e.target.value)}
              required
              minLength={6}
            />
          </>
        )}

        {step === 2 && (
          <>
            <input
              type="text"
              placeholder="Store name (e.g., Earth धान्य Downtown)"
              value={form.branchName}
              onChange={(e) => update("branchName", e.target.value)}
              required
            />
            <input
              type="text"
              placeholder="Store code (optional)"
              value={form.branchCode}
              onChange={(e) => update("branchCode", e.target.value)}
            />
            <input
              type="text"
              placeholder="City"
              value={form.city}
              onChange={(e) => update("city", e.target.value)}
            />
            <input
              type="text"
              placeholder="Address"
              value={form.address}
              onChange={(e) => update("address", e.target.value)}
            />
            <input
              type="tel"
              placeholder="Phone (+91-XXXXXXXXXX)"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
            />
          </>
        )}

        {error && <p className="form-message">{error}</p>}

        {step === 1 ? (
          <button type="button" onClick={nextStep} disabled={loading}>
            Continue
          </button>
        ) : (
          <button type="submit" disabled={loading}>
            {loading ? "Please wait..." : "Create Store"}
          </button>
        )}

        <p className="forgot-password">
          {step === 2 && (
            <button
              type="button"
              onClick={() => setStep(1)}
              style={{ background: "none", border: "none", color: "#222", fontWeight: "bold", textDecoration: "underline", cursor: "pointer", padding: 0, display: "inline" }}
            >
              Back to account details
            </button>
          )}
        </p>

        <p>
          Already have a store? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}