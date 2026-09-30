import { useState } from "react";
import { FiAlertCircle, FiEye, FiEyeOff } from "react-icons/fi";

// One labelled input with its error underneath. A real <label> rather than a
// placeholder, so the field still says what it is once the shopper types.
// Password type gets a show/hide toggle built in, which the storefront had
// no way to do before.
export default function AuthField({
  label,
  name,
  type = "text",
  value,
  onChange,
  error,
  placeholder,
  autoComplete,
  children,
}) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  const input = (
    <input
      id={`auth-${name}`}
      name={name}
      type={isPassword && revealed ? "text" : type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      autoComplete={autoComplete}
      aria-invalid={error ? "true" : undefined}
      aria-describedby={error ? `auth-${name}-err` : undefined}
    />
  );

  return (
    <div className={`auth-field${error ? " invalid" : ""}`}>
      <label htmlFor={`auth-${name}`}>{label}</label>

      {isPassword ? (
        <div className="auth-pw">
          {input}
          <button
            type="button"
            className="auth-eye"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
          >
            {revealed ? <FiEyeOff size={18} /> : <FiEye size={18} />}
          </button>
        </div>
      ) : (
        input
      )}

      {/* children lets PasswordStrength render between the input and the error */}
      {children}

      {error && (
        <p className="auth-err" id={`auth-${name}-err`} role="alert">
          <FiAlertCircle size={13} />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
