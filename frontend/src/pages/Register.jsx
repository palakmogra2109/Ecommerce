import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FiAlertCircle, FiCheckCircle } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import {
  validateName,
  validateEmail,
  validatePassword,
  validateConfirmPassword,
} from "../utils/validation";
import AuthCard from "../components/auth/AuthCard";
import AuthField from "../components/auth/AuthField";
import PasswordStrength from "../components/auth/PasswordStrength";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    const { name, value } = e.target;

    setForm((f) => ({ ...f, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
    setMessage("");
    setOk(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage("");
    setOk(false);

    const newErrors = {};
    const nameError = validateName(form.name);
    const emailError = validateEmail(form.email);
    const passwordError = validatePassword(form.password);
    const confirmError = validateConfirmPassword(
      form.password,
      form.confirmPassword,
    );

    if (nameError) newErrors.name = nameError;
    if (emailError) newErrors.email = emailError;
    if (passwordError) newErrors.password = passwordError;
    if (confirmError) newErrors.confirmPassword = confirmError;

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setLoading(true);

    try {
      const data = await register(form.name, form.email, form.password);

      if (data.success) {
        setForm({ name: "", email: "", password: "", confirmPassword: "" });
        setErrors({});
        setOk(true);
        setMessage(data.message);
        setTimeout(() => navigate("/login"), 1200);
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
      title="Create your account"
      subtitle="One account for orders, addresses and tracking."
      footer={
        <p>
          Already have an account? <Link to="/login">Login</Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {message && (
          <p className={`auth-msg ${ok ? "ok" : "error"}`} role="status">
            {ok ? <FiCheckCircle size={15} /> : <FiAlertCircle size={15} />}
            <span>{message}</span>
          </p>
        )}

        <AuthField
          label="Full name"
          name="name"
          value={form.name}
          onChange={handleChange}
          error={errors.name}
          placeholder="Your name"
          autoComplete="name"
        />

        <AuthField
          label="Email"
          name="email"
          type="email"
          value={form.email}
          onChange={handleChange}
          error={errors.email}
          placeholder="you@email.com"
          autoComplete="email"
        />

        <AuthField
          label="Password"
          name="password"
          type="password"
          value={form.password}
          onChange={handleChange}
          error={errors.password}
          placeholder="Create a password"
          autoComplete="new-password"
        >
          <PasswordStrength password={form.password} />
        </AuthField>

        <AuthField
          label="Confirm password"
          name="confirmPassword"
          type="password"
          value={form.confirmPassword}
          onChange={handleChange}
          error={errors.confirmPassword}
          placeholder="Repeat your password"
          autoComplete="new-password"
        />

        <button className="auth-submit" type="submit" disabled={loading}>
          {loading && <span className="auth-spinner" aria-hidden="true" />}
          {loading ? "Creating…" : "Create account"}
        </button>
      </form>
    </AuthCard>
  );
}
