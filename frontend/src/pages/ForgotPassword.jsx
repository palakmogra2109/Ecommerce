import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  forgotPassword,
  resetPassword,
} from "../services/auth";
import {
  validateEmail,
  validatePassword,
  validateConfirmPassword,
} from "../utils/validation";
import PasswordInput from "../components/PasswordInput";

export default function ForgotPassword() {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCheckEmail(e) {
    e.preventDefault();

    setError("");
    setMessage("");

    const emailError = validateEmail(email);

    if (emailError) {
      setError(emailError);
      return;
    }

    setLoading(true);

    try {
      const data = await forgotPassword(email);

      if (data.success) {
        setStep(2);
        setMessage("");
      } else {
        setError(data.message);
      }
    } catch (error) {
      setError(
        "Unable to connect to the server. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();

    setError("");
    setMessage("");

    const passwordError = validatePassword(password);
    const confirmError = validateConfirmPassword(
      password,
      confirmPassword
    );

    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (confirmError) {
      setError(confirmError);
      return;
    }

    setLoading(true);

    try {
      const data = await resetPassword(email, password);

      if (data.success) {
        setMessage(data.message);
        setEmail("");
        setPassword("");
        setConfirmPassword("");

        setTimeout(() => {
          navigate("/login");
        }, 1500);
      } else {
        setError(data.message);
      }
    } catch (error) {
      setError(
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
        onSubmit={
          step === 1
            ? handleCheckEmail
            : handleResetPassword
        }
      >
        <h1>
          {step === 1 ? "Forgot Password" : "Change Password"}
        </h1>

        {step === 1 ? (
          <>
            <input
              type="email"
              name="email"
              placeholder="Email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
                setMessage("");
              }}
              autoComplete="email"
            />

            {error && (
              <p className="input-error">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
            >
              {loading ? "Checking..." : "Continue"}
            </button>
          </>
        ) : (
          <>
            <p className="reset-hint">
              Set a new password for{" "}
              <strong>{email}</strong>
            </p>

            <PasswordInput
              name="password"
              placeholder="New Password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              autoComplete="new-password"
            />

            <PasswordInput
              name="confirmPassword"
              placeholder="Confirm New Password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setError("");
              }}
              autoComplete="new-password"
            />

            {error && (
              <p className="input-error">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
            >
              {loading ? "Updating..." : "Update Password"}
            </button>
          </>
        )}

        {message && (
          <p className="form-message">
            {message}
          </p>
        )}

        <p>
          Remember your password?{" "}
          <Link to="/login">
            Login
          </Link>
        </p>
      </form>
    </div>
  );
}
