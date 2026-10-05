import { useCallback, useEffect, useState } from "react";
import {
  listSupplierBankAccounts, createSupplierBankAccount, updateSupplierBankAccount,
  setPrimarySupplierBankAccount, retireSupplierBankAccount,
} from "../services/purchases";
import { useAuth } from "../context/AuthContext";
import { Notice } from "./PurchaseInvoices";

// Bank details popup, opened from the bank icon on a supplier row.
//
// Account numbers are shown masked and there is no reveal control: the backend
// never returns them in full, so there is nothing here to reveal. The four digits
// that are visible are enough to tell two accounts apart.

// Letters and digits, up to 11 characters -- not the exact Indian IFSC layout.
// The strict shape (HDFC0001234) is still checked separately, but only to warn:
// refusing a value the business genuinely uses leaves them unable to record how
// to pay a supplier, and an overseas account has no IFSC at all.
const IFSC = /^[A-Z0-9]{1,11}$/;
const IFSC_STANDARD = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER = /^[0-9]{6,20}$/;

const blank = () => ({
  account_name: "", bank_name: "", account_number: "", ifsc: "",
  swift_code: "", branch: "", account_type: "CURRENT", notes: "",
});

export default function SupplierBankPopup({ supplier, onClose }) {
  const { can } = useAuth();
  const mayManage = can("suppliers.bank.manage");

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [editing, setEditing] = useState(null);

  const reload = useCallback(async () => {
    const data = await listSupplierBankAccounts(supplier.uuid);
    setAccounts(data.accounts || []);
  }, [supplier.uuid]);

  useEffect(() => {
    reload()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [reload]);

  const run = async (fn, message) => {
    setError("");
    setOk("");
    try {
      await fn();
      await reload();
      if (message) setOk(message);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };

  return (
    <>
    <div className="filament-modal-overlay" onClick={onClose}>
      <div
        className="filament-modal filament-modal-lg sp-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Bank details for ${supplier.name}`}
      >
        <div className="filament-modal-header">
          <div>
            <h2>Bank details</h2>
            <p className="filament-modal-sub">
              {supplier.name} · account numbers are stored masked
            </p>
          </div>
          <button type="button" className="filament-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="filament-modal-body sp-body">
          {error && <Notice>{error}</Notice>}
          {ok && <Notice>{ok}</Notice>}

          {loading && <p className="input-hint">Loading…</p>}
          {!loading && accounts.length === 0 && (
            <p className="input-hint">
              No bank details yet. {mayManage ? "Add one below." : ""}
            </p>
          )}

          {accounts.map((account) => (
            <div key={account.uuid} className={`sp-bank${account.is_primary ? " sp-bank-primary" : ""}`}>
              <div className="sp-bank-top">
                <strong>{account.account_name}</strong>
                <div className="sp-bank-badges">
                  {account.is_primary && <span className="filament-badge filament-badge-active">Primary</span>}
                  {!account.is_active && <span className="filament-badge filament-badge-inactive">Retired</span>}
                  <span className="filament-badge">{account.account_type}</span>
                </div>
              </div>
              <dl className="sp-bank-grid">
                <div><dt>Bank</dt><dd>{account.bank_name}</dd></div>
                <div>
                  <dt>Account number</dt>
                  <dd className="sp-mono">{account.account_number_masked}</dd>
                </div>
                {account.ifsc && <div><dt>IFSC</dt><dd className="sp-mono">{account.ifsc}</dd></div>}
                {account.branch && <div><dt>Branch</dt><dd>{account.branch}</dd></div>}
                {account.swift_code && <div><dt>SWIFT</dt><dd className="sp-mono">{account.swift_code}</dd></div>}
              </dl>
              {mayManage && (
                <div className="sp-bank-actions">
                  {!account.is_primary && account.is_active && (
                    <button
                      type="button" className="filament-btn filament-btn-small filament-btn-secondary"
                      onClick={() => run(
                        () => setPrimarySupplierBankAccount(supplier.uuid, account.uuid),
                        "Primary account updated"
                      )}
                    >
                      Make primary
                    </button>
                  )}
                  <button
                    type="button" className="filament-btn filament-btn-small filament-btn-outline"
                    onClick={() => setEditing(account)}
                  >
                    Edit
                  </button>
                  {account.is_active && (
                    <button
                      type="button" className="filament-btn filament-btn-small filament-btn-danger"
                      onClick={() => run(
                        () => retireSupplierBankAccount(supplier.uuid, account.uuid),
                        "Account retired"
                      )}
                    >
                      Retire
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          {mayManage && !editing && (
            <button
              type="button" className="filament-btn filament-btn-primary"
              onClick={() => setEditing(blank())}
            >
              Add bank account
            </button>
          )}
        </div>

        <div className="filament-modal-footer">
          <button type="button" className="filament-btn filament-btn-outline" onClick={onClose}>Close</button>
        </div>

      </div>
    </div>

    {/* A sibling overlay, not a child of the popup above: two nested fixed
        overlays race on paint order, and the wrong one wins and eats clicks. */}
    {editing && (
      <BankAccountForm
        supplier={supplier}
        account={accounts.find((a) => a.uuid === editing.uuid) || null}
        initial={editing}
        onClose={() => setEditing(null)}
        onSaved={async (message) => {
          setEditing(null);
          setOk(message);
          await reload();
        }}
      />
    )}
    </>
  );
}

function BankAccountForm({ supplier, account, initial, onClose, onSaved }) {
  // Coerced, not spread. A saved account comes back from the API with null for
  // branch, swift_code and notes, and `{ ...blank(), ...initial }` let those nulls
  // overwrite the "" defaults -- so the first .trim() on them threw
  // "Cannot read properties of null" the moment you tried to save.
  const [form, setForm] = useState(() =>
    Object.fromEntries(
      Object.keys(blank()).map((key) => [
        key,
        initial[key] === undefined || initial[key] === null ? "" : String(initial[key]),
      ])
    )
  );
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (field) => (event) => {
    const value = event.target.value;
    setForm((c) => ({ ...c, [field]: value }));
    setErrors((c) => ({ ...c, [field]: undefined, form: undefined }));
  };

  // Digits only, and shown as typed so the operator can see what they pasted.
  const digits = form.account_number.replace(/[\s-]/g, "");
  const ifsc = form.ifsc.trim().toUpperCase();

  const problems = {};
  if (!form.account_name.trim()) problems.account_name = "Whose account is it?";
  if (!form.bank_name.trim()) problems.bank_name = "Enter the bank name";
  // On edit the number is never returned in full, so the field is blank by
  // design and a blank means "keep the current number". Validating it as
  // required made Save permanently disabled for every existing account.
  if (account) {
    if (form.account_number.trim() && !ACCOUNT_NUMBER.test(digits)) {
      problems.account_number = "6 to 20 digits";
    }
  } else if (!ACCOUNT_NUMBER.test(digits)) {
    problems.account_number = "6 to 20 digits";
  }
  if (ifsc && !IFSC.test(ifsc)) problems.ifsc = "Letters and numbers, up to 11 characters";
  // Informational only: it saves, but says plainly that this will not work with
  // an Indian payment gateway.
  const ifscUnusual = Boolean(ifsc) && IFSC.test(ifsc) && !IFSC_STANDARD.test(ifsc);

  const submit = async (event) => {
    event.preventDefault();
    if (busy || Object.keys(problems).length) return;
    setBusy(true);
    setErrors({});
    try {
      const payload = {
        account_name: form.account_name.trim(),
        bank_name: form.bank_name.trim(),
        // Omitted when left blank on edit, so the stored number is untouched.
        // Sending the mask back would corrupt it.
        ...(account ? (digits ? { account_number: digits } : {}) : { account_number: digits }),
        ifsc: ifsc || null,
        swift_code: form.swift_code.trim().toUpperCase() || null,
        branch: form.branch.trim() || null,
        account_type: form.account_type,
        notes: form.notes.trim() || null,
      };
      if (account) {
        await updateSupplierBankAccount(supplier.uuid, account.uuid, payload);
        onSaved("Bank details updated");
      } else {
        await createSupplierBankAccount(supplier.uuid, payload);
        onSaved("Bank details added");
      }
      onClose();
    } catch (e) {
      setErrors({ form: e.message });
    } finally {
      setBusy(false);
    }
  };

  // `problems` is computed from what is typed, `errors` only after the server
  // refuses. Both must be shown: gating the submit button on `problems` without
  // rendering it left a dead button that explained nothing.
  const message = (key) => problems[key] || errors[key];

  const field = (key, label, extra = {}) => (
    <label className="frm-field">
      <span>{label}</span>
      <input
        type="text"
        value={form[key]}
        onChange={set(key)}
        className={message(key) ? "frm-bad" : undefined}
        {...extra}
      />
      {message(key) && <small className="frm-error">{message(key)}</small>}
    </label>
  );

  return (
    <div className="filament-modal-overlay" onClick={onClose}>
      <div
        className="filament-modal filament-modal-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="filament-modal-header">
          <div>
            <h2>{account ? "Edit bank account" : "Add bank account"}</h2>
            <p className="filament-modal-sub">{supplier.name}</p>
          </div>
          <button type="button" className="filament-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="filament-modal-body">
            {errors.form && <Notice>{errors.form}</Notice>}
            <div className="frm-grid">
              {field("account_name", "Account holder *", { placeholder: "As printed on the account" })}
              {field("bank_name", "Bank *", { placeholder: "HDFC Bank" })}
            </div>
            <div className="frm-grid">
              <label className="frm-field">
                <span>Account number *</span>
                <input
                  type="text" inputMode="numeric" value={form.account_number}
                  onChange={set("account_number")} placeholder="50100234567890"
                  className={!ACCOUNT_NUMBER.test(digits) && form.account_number ? "frm-bad" : undefined}
                />
                {message("account_number") && (
                  <small className="frm-error">{message("account_number")}</small>
                )}
                {account && !form.account_number.trim() && (
                  <small className="frm-hint">
                    Leave blank to keep the current number ({account.account_number_masked}).
                    It is stored securely and never shown in full.
                  </small>
                )}
                {!account && ACCOUNT_NUMBER.test(digits) && (
                  <small className="frm-hint">Stored securely; shown as ••••{digits.slice(-4)} afterwards</small>
                )}
                {account && form.account_number.trim() && ACCOUNT_NUMBER.test(digits) && (
                  <small className="frm-hint frm-hint-ok">
                    Will be replaced with ••••{digits.slice(-4)}
                  </small>
                )}
              </label>
              <label className="frm-field">
                <span>Account type</span>
                <select value={form.account_type} onChange={set("account_type")}>
                  <option value="CURRENT">Current account</option>
                  <option value="SAVINGS">Savings account</option>
                </select>
              </label>
            </div>
            <div className="frm-grid">
              <label className="frm-field">
                <span>IFSC / bank code</span>
                <input
                  type="text" maxLength={11} value={form.ifsc}
                  onChange={(e) => setForm((c) => ({ ...c, ifsc: e.target.value.toUpperCase() }))}
                  placeholder="HDFC0001234"
                  className={ifsc && !IFSC.test(ifsc) ? "frm-bad" : ifsc ? "frm-ok" : undefined}
                />
                {message("ifsc") && <small className="frm-error">{message("ifsc")}</small>}
                {!message("ifsc") && ifscUnusual && (
                  <small className="frm-hint frm-warn">
                    Saved, but this is not a standard Indian IFSC (that looks like HDFC0001234).
                    An Indian payment gateway will reject it — for an overseas account use SWIFT / BIC.
                  </small>
                )}
                {!message("ifsc") && ifsc && !ifscUnusual && (
                  <small className="frm-hint frm-hint-ok">Standard IFSC</small>
                )}
              </label>
              {field("branch", "Branch", { placeholder: "Optional" })}
            </div>
            <div className="frm-grid">
              {field("swift_code", "SWIFT / BIC", {
                placeholder: "Overseas only",
                onChange: (e) => setForm((c) => ({ ...c, swift_code: e.target.value.toUpperCase() })),
              })}
              {field("notes", "Notes", { placeholder: "Optional" })}
            </div>
          </div>
          <div className="filament-modal-footer">
            <button type="button" className="filament-btn filament-btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="filament-btn filament-btn-primary"
              disabled={busy || Object.keys(problems).length > 0}>
              {busy ? "Saving…" : account ? "Save changes" : "Add account"}
            </button>
            {!busy && Object.keys(problems).length > 0 && (
              <small className="frm-hint frm-error">
              </small>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
