import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { getSupplier } from "../services/purchases";
import SupplierStatusControl from "../components/SupplierStatusControl";
import SupplierBankPopup from "./SupplierBankPopup";
import { Notice } from "./PurchaseInvoices";

const rupees = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// Read-only supplier view, at /suppliers/:id. Editing lives at
// /suppliers/:id/edit, the same split the gift-card pages use.
//
// Account numbers are shown masked and there is no reveal: the backend never
// returns them in full, so there is nothing here to reveal. The last four digits
// are enough to tell two accounts apart.

function Row({ label, value, mono }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="sp-ro-row">
      <dt>{label}</dt>
      <dd className={mono ? "sp-mono" : undefined}>{value}</dd>
    </div>
  );
}

export default function SupplierView() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [supplier, setSupplier] = useState(null);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);

  const reload = useCallback(async () => {
    const data = await getSupplier(id);
    setSupplier(data.supplier);
    setBalance(data.balance);
    return data.supplier;
  }, [id]);

  useEffect(() => {
    reload()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [reload]);

  const act = async (fn, message) => {
    setBusy(true);
    setError("");
    setOk("");
    try {
      await fn();
      setOk(message);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="filament-page"><div className="filament-empty">Loading…</div></div>;
  if (!supplier) {
    return (
      <div className="filament-page">
        <Notice>{error || "Supplier not found."}</Notice>
        <button type="button" className="filament-btn filament-btn-outline" onClick={() => navigate("/suppliers")}>
          Back to suppliers
        </button>
      </div>
    );
  }

  return (
    <div className="filament-page">
      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h2>{supplier.name}</h2>
            <p className="filament-card-subtitle">
              {supplier.is_active ? "Active" : "Retired"}
              {supplier.gstin ? ` · ${supplier.gstin}` : ""}
              {supplier.payment_terms_days
                ? ` · ${supplier.payment_terms_days === 0 ? "due immediately" : `net ${supplier.payment_terms_days} days`}`
                : ""}
            </p>
          </div>
          <div className="filament-card-header-right">
            <button type="button" className="filament-btn filament-btn-outline" onClick={() => navigate("/suppliers")}>
              Back
            </button>
            <button type="button" className="filament-btn filament-btn-primary" onClick={() => navigate(`/suppliers/${supplier.uuid}/edit`)}>
              Edit
            </button>
          </div>
        </div>

        {error && <Notice>{error}</Notice>}
        {ok && <Notice>{ok}</Notice>}

        {balance && (
          <div className="filament-card-filters">
            <div><span className="form-label">Invoiced</span><strong>{rupees(balance.invoiced)}</strong></div>
            <div><span className="form-label">Paid</span><strong>{rupees(balance.paid)}</strong></div>
            <div><span className="form-label">Outstanding</span><strong>{rupees(balance.outstanding)}</strong></div>
          </div>
        )}

        <h3 className="frm-section">Contact</h3>
        <dl className="sp-ro">
          <Row label="Contact person" value={supplier.contact_name} />
          <Row label="Email" value={supplier.email} />
          <Row label="Phone" value={supplier.phone} />
        </dl>

        <h3 className="frm-section">Address</h3>
        <dl className="sp-ro">
          <Row label="Address" value={supplier.address} />
          <Row label="City" value={supplier.city} />
          <Row label="State" value={supplier.state} />
          <Row label="PIN / postcode" value={supplier.postal_code} mono />
          <Row label="Country" value={supplier.country} />
        </dl>

        <h3 className="frm-section">Tax</h3>
        <dl className="sp-ro">
          <Row label="GSTIN / tax registration" value={supplier.gstin} mono />
        </dl>

        {supplier.notes && (
          <>
            <h3 className="frm-section">Notes</h3>
            <p className="sp-ro-notes">{supplier.notes}</p>
          </>
        )}

        <h3 className="frm-section">Bank details</h3>
        <button type="button" className="filament-btn filament-btn-outline" onClick={() => setBankOpen(true)}>
          View bank accounts
        </button>
        <p className="input-hint" style={{ marginTop: 6 }}>
          Account numbers are stored securely and always shown masked.
        </p>

        <hr className="frm-rule" />
        <SupplierStatusControl
          supplier={supplier}
          onChanged={async (message) => { setOk(message); await reload(); }}
        />

        <div className="filament-modal-footer" style={{ border: "none", marginTop: 18 }}>
          <Link className="filament-btn filament-btn-outline" to="/suppliers">
            Back to list
          </Link>
        </div>
      </div>

      {bankOpen && <SupplierBankPopup supplier={supplier} onClose={() => setBankOpen(false)} />}
    </div>
  );
}
