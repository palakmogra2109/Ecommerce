import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getSupplier } from "../services/purchases";
import SupplierStatusControl from "../components/SupplierStatusControl";
import SupplierForm from "./SupplierForm";
import SupplierBankPopup from "./SupplierBankPopup";
import { Notice } from "./PurchaseInvoices";

const rupees = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// Supplier edit at /suppliers/:id/edit, kept separate from the read-only view so
// the view page can never accidentally mutate a record by being opened.
//
// Retire is offered here as well as on the view page because that is where
// someone editing a supplier's details is most likely to be replacing them
// wholesale. It stays a distinct, labelled action rather than a silent side
// effect of saving.

export default function SupplierEdit() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [supplier, setSupplier] = useState(null);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
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
            <h2>Edit supplier</h2>
            <p className="filament-card-subtitle">
              {supplier.name}
              {balance && ` · ${rupees(balance.outstanding)} outstanding`}
            </p>
          </div>
          <div className="filament-card-header-right">
            <button
              type="button" className="filament-btn filament-btn-outline"
              onClick={() => navigate(`/suppliers/${supplier.uuid}`)}
            >
              View
            </button>
          </div>
        </div>

        {error && <Notice>{error}</Notice>}
        {ok && <Notice>{ok}</Notice>}

        <SupplierForm
          supplier={supplier}
          closeOnSave={false}
          onClose={() => navigate(`/suppliers/${supplier.uuid}`)}
          onSaved={async (message) => {
            setOk(message);
            await reload();
          }}
        />

        <div className="filament-modal-footer" style={{ border: "none", marginTop: 14 }}>
          <button type="button" className="filament-btn filament-btn-outline" onClick={() => setBankOpen(true)}>
            Bank details
          </button>
          <SupplierStatusControl
            supplier={supplier}
            onChanged={async (message) => { setOk(message); await reload(); }}
          />
        </div>
      </div>

      {bankOpen && <SupplierBankPopup supplier={supplier} onClose={() => setBankOpen(false)} />}
    </div>
  );
}
