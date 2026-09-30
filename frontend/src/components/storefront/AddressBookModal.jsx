import { useEffect, useMemo, useState } from "react";
import { FiCheck, FiMapPin, FiEdit2, FiPlus, FiTrash2, FiX } from "react-icons/fi";
import AddressForm from "./AddressForm";

function formatAddress(entry) {
  return [entry.line1, entry.line2, entry.landmark].filter(Boolean).join(", ");
}

export default function AddressBookModal({ open, addressBook, user, notify, onSelect, onClose }) {
  const [tab, setTab] = useState("saved");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filterText, setFilterText] = useState("");

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return addressBook.addresses;
    return addressBook.addresses.filter((entry) =>
      [entry.label, entry.recipient, entry.line1, entry.line2, entry.city, entry.state, entry.postalCode]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [addressBook.addresses, filterText]);

  useEffect(() => {
    if (!open) return;
    setTab("saved");
    setEditing(null);
    setFilterText("");
  }, [open ]);

  if (!open) return null;

  async function handleSubmit(payload) {
    setSaving(true);
    const saved = editing
      ? await addressBook.editAddress(editing.id, payload)
      : await addressBook.saveAddress(payload);
    setSaving(false);
    if (saved) {
      setEditing(null);
      setTab("saved");
    }
  }

  return (
    <div className="sf-modal-veil" role="dialog" aria-modal="true" aria-label="Choose delivery address">
      <div className="sf-address-modal">
        <div className="sf-address-modal-head">
          <div>
            <h3>Deliver to</h3>
            <p>{user?.email || "Choose where your order should go."}</p>
          </div>
          <button type="button" className="sf-icon-btn" onClick={onClose} aria-label="Close address book"><FiX /></button>
        </div>

        <div className="sf-address-tabs">
          <button type="button" className={tab === "saved" ? "on" : ""} onClick={() => setTab("saved")}>Saved addresses</button>
          <button type="button" className={tab === "add" ? "on" : ""} onClick={() => { setEditing(null); setTab("add"); }}>
            <FiPlus /> Add new address
          </button>
        </div>

        {tab === "saved" && (
          <div className="sf-address-list">
            <div className="sf-field">
              <label>Filter saved addresses</label>
              <input className="sf-input" value={filterText} onChange={(event) => setFilterText(event.target.value)} placeholder="Search Home, city, or pincode" />
            </div>
            {addressBook.loading && <p className="muted">Loading saved addresses…</p>}
            {addressBook.error && <p className="sf-err">{addressBook.error}</p>}
            {!addressBook.loading && filtered.length === 0 && (
              <div className="sf-empty"><FiMapPin size={28} /><p>No saved addresses yet.</p></div>
            )}
            {filtered.map((entry) => (
              <div key={entry.id} className={`sf-address-row${addressBook.selectedAddressId === entry.id ? " on" : ""}`}>
                <button type="button" className="sf-address-pick" onClick={() => onSelect(entry)}>
                  <span className="sf-radio-dot">{addressBook.selectedAddressId === entry.id && <FiCheck />}</span>
                  <span>
                    <strong>{entry.label}{entry.isDefault && <em>Default</em>}</strong>
                    <span>{formatAddress(entry)}</span>
                    <span>{entry.city}, {entry.state} — {entry.postalCode} · {entry.phone}</span>
                  </span>
                </button>
                <span className="sf-address-row-actions">
                  <button type="button" className="sf-icon-btn" title="Edit" onClick={() => { setEditing(entry); setTab("add"); }}><FiEdit2 /></button>
                  <button type="button" className="sf-icon-btn" title="Delete" onClick={() => addressBook.removeAddress(entry.id)}><FiTrash2 /></button>
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === "add" && (
          <AddressForm
            initial={editing}
            saving={saving}
            notify={notify}
            onCancel={() => { setEditing(null); setTab("saved"); }}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </div>
  );
}
