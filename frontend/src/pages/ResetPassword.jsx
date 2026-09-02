import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PasswordInput from "../components/PasswordInput";
import { resetPassword } from "../services/auth";
import { validatePassword } from "../utils/validation";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const token = searchParams.get("token");

  const [form, setForm] = useState({
    password: "",
    confirmPassword: "",
  });

  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    setErrors((prev) => ({
      ...prev,
      [name]: "",
    }));

    setMessage("");
  }

  async function handleSubmit(e) {
    e.preventDefault();

    setErrors({});
    setMessage("");

    if (!token) {
      setMessage("Invalid or expired reset link.");
      return;
    }

    const newErrors = {};

    const passwordError = validatePassword(form.password);

    if (passwordError) {
      newErrors.password = passwordError;
    }

    if (!form.confirmPassword) {
      newErrors.confirmPassword =
        "Please confirm your password.";
    } else if (
      form.password !== form.confirmPassword
    ) {
      newErrors.confirmPassword =
        "Passwords do not match.";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);

    try {
      const data = await resetPassword(
        token,
        form.password
      );

      if (data.success) {
        setForm({
          password: "",
          confirmPassword: "",
        });

        // Password changed successfully
        navigate("/login");
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
        <h1>Change Password</h1>

        <PasswordInput
          name="password"
          placeholder="New Password"
          value={form.password}
          onChange={handleChange}
          autoComplete="new-password"
        />

        {errors.password && (
          <p className="input-error">
            {errors.password}
          </p>
        )}

        <PasswordInput
          name="confirmPassword"
          placeholder="Confirm New Password"
          value={form.confirmPassword}
          onChange={handleChange}
          autoComplete="new-password"
        />

        {errors.confirmPassword && (
          <p className="input-error">
            {errors.confirmPassword}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
        >
          {loading
            ? "Changing Password..."
            : "Change Password"}
        </button>

        {message && (
          <p className="form-message">
            {message}
          </p>
        )}
      </form>
    </div>
  );
}