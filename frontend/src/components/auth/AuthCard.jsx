import "../../styles/Auth.css";

// The centered card every auth screen renders into. Owns the page background,
// the card shell and the heading, so Login, Register and the storefront panel
// cannot drift apart again.
export default function AuthCard({
  title,
  subtitle,
  children,
  footer,
}) {
  return (
    <div className="auth-root">
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-head">
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>

          {children}

          {footer && <div className="auth-foot">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
