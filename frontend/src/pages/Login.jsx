import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  validateEmail,
  validatePassword,
} from "../utils/validation";
import PasswordInput from "../components/PasswordInput";

export default function Login() {
  const { login, getLandingPath } = useAuth();

  const navigate = useNavigate();

  const [form, setForm] = useState({
    email: "",
    password: "",
  });

  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);


  function handleChange(e) {
    const { name, value } = e.target;

    setForm({
      ...form,
      [name]: value,
    });

    // Remove error for this field while typing
    setErrors({
      ...errors,
      [name]: "",
    });

    setMessage("");
  }


  async function handleSubmit(e) {
    e.preventDefault();

    setMessage("");

    const newErrors = {};

    const emailError = validateEmail(form.email);
    const passwordError = validatePassword(form.password);

    if (emailError) {
      newErrors.email = emailError;
    }

    if (passwordError) {
      newErrors.password = passwordError;
    }

    setErrors(newErrors);

    // Stop API request if validation fails
    if (Object.keys(newErrors).length > 0) {
      return;
    }

    setLoading(true);

    try {
      const data = await login(
        form.email,
        form.password
      );

      if (data.success) {
        setForm({
          email: "",
          password: "",
        });

        setErrors({});

        navigate(getLandingPath());
      } else {
        setMessage(data.message);
      }
    } catch (error) {
      console.error(error);

      setMessage(
        "Unable to connect to the server. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }


  return (
    <div className="auth-container">
      <form
        className="auth-form"
        onSubmit={handleSubmit}
      >
        <h1>Login</h1>

        <input
          type="email"
          name="email"
          placeholder="Email"
          value={form.email}
          onChange={handleChange}
          autoComplete="username"
        />

        {errors.email && (
          <p className="input-error">
            {errors.email}
          </p>
        )}


        <PasswordInput
          name="password"
          placeholder="Password"
          value={form.password}
          onChange={handleChange}
          autoComplete="current-password"
        />

        {errors.password && (
          <p className="input-error">
            {errors.password}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
        >
          {loading ? "Logging in..." : "Login"}
        </button>

        <p className="forgot-password">
          <Link to="/forgot-password">
            Forgot password?
          </Link>
        </p>


        {message && (
          <p className="form-message">
            {message}
          </p>
        )}


        <p>
          Don't have an account?{" "}
          <Link to="/register">
            Register
          </Link>
        </p>
      </form>
    </div>
  );
}
