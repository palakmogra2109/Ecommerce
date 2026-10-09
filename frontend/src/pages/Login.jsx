import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FiAlertCircle, FiClock } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { validateEmail, validatePassword } from "../utils/validation";
import AuthCard from "../components/auth/AuthCard";
import AuthField from "../components/auth/AuthField";

// mm:ss. A lockout is 15 minutes (LOCKOUT_MS in lib/giftCardGuards.js), so it
// never needs an hours field.
function formatLockout(totalSec) {
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

export default function Login() {
  const { login, getLandingPath } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // Seconds left on a throttled client, 0 when not locked out. Seeded from the
  // Retry-After the server sent, so the number on screen is the server's own
  // timing rather than a guess made here.
  const [lockoutSec, setLockoutSec] = useState(0);
  const locked = lockoutSec > 0;

  // Whether the message on screen is a lockout refusal or an ordinary error, so
  // the countdown ending can take one with it and leave the other alone.
  const [messageIsLockout, setMessageIsLockout] = useState(false);

  // One interval for the whole lockout, keyed on whether we are locked rather
  // than on the counter — depending on the counter would tear the interval down
  // and rebuild it every second.
  useEffect(() => {
    if (!locked) return;

    const timer = setInterval(() => {
      setLockoutSec((sec) => (sec <= 1 ? 0 : sec - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [locked]);

  // Derived during render rather than cleared by an effect. A lockout refusal
  // stops being shown the moment the countdown is over, so it never sits on a
  // form that is already usable again telling the shopper to wait.
  const visibleMessage = messageIsLockout && !locked ? "" : message;

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
        setLockoutSec(0);
        setMessageIsLockout(false);
        navigate(getLandingPath());
      } else {
        // Only a throttled response carries a usable Retry-After; anything else
        // (401, a 429 with the header stripped or set to a date) is an ordinary
        // error that must survive the countdown machinery entirely.
        const throttled = data.status === 429 && data.retryAfterSec > 0;

        setMessage(data.message);
        setMessageIsLockout(throttled);
        setLockoutSec(throttled ? data.retryAfterSec : 0);
      }
    } catch {
      // An ordinary error, so the lockout flag must be cleared with it —
      // otherwise a connection failure arriving after a lockout has expired
      // would be swallowed by the same rule that hides the finished countdown.
      setMessage("Unable to connect to the server. Please try again.");
      setMessageIsLockout(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="Welcome To Earth Dhanya"
      subtitle="Log in to manage your account and orders."
      footer={
        <>
          <Link className="auth-forgot" to="/forgot-password">
            Forgot password?
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {visibleMessage && (
          <p className="auth-msg error" role="alert">
            <FiAlertCircle size={15} />
            <span>{visibleMessage}</span>
          </p>
        )}

        {locked && (
          // Deliberately outside the role="alert" above: a node whose text
          // changes every second inside an alert is re-announced by a screen
          // reader on every tick. The static sentence is the announcement; the
          // clock is just a visual aid, so it is silent.
          <p className="auth-msg error auth-lockout">
            <FiClock size={15} />
            <span>
              Try again in{" "}
              <span className="auth-lockout-clock" aria-live="off">
                {formatLockout(lockoutSec)}
              </span>
            </span>
          </p>
        )}

        <AuthField
          label="Email"
          name="email"
          type="email"
          value={form.email}
          onChange={handleChange}
          error={errors.email}
          placeholder="Enter your email"
          autoComplete="username"
        />

        <AuthField
          label="Password"
          name="password"
          type="password"
          value={form.password}
          onChange={handleChange}
          error={errors.password}
          placeholder="Enter your password"
          autoComplete="current-password"
        />

        <button className="auth-submit" type="submit" disabled={loading || locked}>
          {loading && <span className="auth-spinner" aria-hidden="true" />}
          {loading ? "Logging in…" : "Login"}
        </button>
      </form>
    </AuthCard>
  );
}
