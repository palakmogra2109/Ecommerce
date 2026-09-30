import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FiAlertCircle } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { validateEmail, validatePassword } from "../utils/validation";
import AuthCard from "../components/auth/AuthCard";
import AuthField from "../components/auth/AuthField";

export default function Login() {
  const { login, getLandingPath } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    const { name, value } = e.target;

    setForm((f) => ({ ...f, [name]: value }));
    // Clear this field's error as soon as they start fixing it, so the red
    // border does not sit there while they are mid-correction.
    setErrors((prev) => ({ ...prev, [name]: "" }));
    setMessage("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage("");

    const emailError = validateEmail(form.email);
    const passwordError = validatePassword(form.password);
    const newErrors = {};

    if (emailError) newErrors.email = emailError;
    if (passwordError) newErrors.password = passwordError;

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setLoading(true);

    try {
      const data = await login(form.email, form.password);

      if (data.success) {
        setForm({ email: "", password: "" });
        setErrors({});
        navigate(getLandingPath());
      } else {
        setMessage(data.message);
      }
    } catch {
      setMessage("Unable to connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Log in to manage your account and orders."
      footer={
        <>
          <Link className="auth-forgot" to="/forgot-password">
            Forgot password?
          </Link>
          <p>
            Don&apos;t have an account? <Link to="/register">Register</Link>
          </p>
          <p>
            Want to open a store?{" "}
            <Link to="/register/store">Register your store</Link>
          </p>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {message && (
          <p className="auth-msg error" role="alert">
            <FiAlertCircle size={15} />
            <span>{message}</span>
          </p>
        )}

        <AuthField
          label="Email"
          name="email"
          type="email"
          value={form.email}
          onChange={handleChange}
          error={errors.email}
          placeholder="you@email.com"
          autoComplete="username"
        />

        <AuthField
          label="Password"
          name="password"
          type="password"
          value={form.password}
          onChange={handleChange}
          error={errors.password}
          placeholder="Your password"
          autoComplete="current-password"
        />

        <button className="auth-submit" type="submit" disabled={loading}>
          {loading && <span className="auth-spinner" aria-hidden="true" />}
          {loading ? "Logging in…" : "Login"}
        </button>
      </form>
    </AuthCard>
  );
}
