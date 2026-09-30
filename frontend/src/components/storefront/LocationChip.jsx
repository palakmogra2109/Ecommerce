import { FiMapPin } from "react-icons/fi";

export default function LocationChip({ address, loading, onOpen }) {
  const title = address ? `${address.label || "Saved address"} · ${address.city || ""}` : "Add location";
  return (
    <button type="button" className="sf-location-chip" onClick={onOpen} aria-label={loading ? "Loading delivery location" : `Deliver to ${title}`} title={loading ? "Loading delivery location" : `Deliver to ${title}`}>
      <FiMapPin aria-hidden="true" />
      <span className="sf-location-txt">
        <small>Deliver to</small>
        <strong>{loading ? "Locating…" : title}</strong>
      </span>
    </button>
  );
}
