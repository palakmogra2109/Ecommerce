import { FiCheck, FiCircle } from "react-icons/fi";

// These four checks are the same rules validatePassword() enforces in
// utils/validation.js, duplicated deliberately: the meter needs to score a
// partial password, which the validator cannot do because it returns on the
// first failure. If a rule changes in the validator it must change here too,
// or the meter will promise a password the form then rejects.
const RULES = [
  { key: "len", label: "At least 6 characters", test: (p) => p.length >= 6 },
  { key: "upper", label: "One uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { key: "lower", label: "One lowercase letter", test: (p) => /[a-z]/.test(p) },
  { key: "digit", label: "One number", test: (p) => /\d/.test(p) },
  { key: "special", label: "One special character", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

// Score is how many rules pass, not a cryptanalytic strength estimate: a
// 6-character password that satisfies all five is a 4, because it also clears
// the 12-character bonus below.
function score(password) {
  if (!password) return 0;

  const passed = RULES.filter((r) => r.test(password)).length;
  if (passed < 3) return passed >= 2 ? 1 : 0;
  if (passed < 5) return 2;
  return password.length >= 12 ? 4 : 3;
}

const LABELS = ["", "Weak", "Fair", "Good", "Strong"];

export default function PasswordStrength({ password }) {
  const s = score(password);
  if (!password) return null;

  return (
    <div className={`auth-strength s${s}`}>
      <div className={`auth-meter s${s}`} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <span className="auth-strength-label">
        Password strength: {LABELS[s]}
      </span>
      <ul className="auth-rules">
        {RULES.map((r) => {
          const ok = r.test(password);
          return (
            <li key={r.key} className={ok ? "ok" : ""}>
              {ok ? <FiCheck size={12} /> : <FiCircle size={12} />}
              {r.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
