import { useEffect, useRef, useState } from "react";
import { searchProductsForPurchase } from "../services/purchases";

// Searchable product picker for a purchase-invoice line.
//
// Typing queries the catalogue; picking a result shows the product with its
// current stock so the operator can sanity-check the quantity they are about to
// order. The picked product's id is what gets posted, so the form never carries a
// hand-typed product id that could point at the wrong row.
export default function ProductPicker({ value, onChange, excludeUuids = [], label }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef(null);
  const requestRef = useRef(0);

  // Debounced so a fast typist does not fire a request per keystroke, and the
  // request id discards a slow reply that arrived after a newer one.
  useEffect(() => {
    if (!open) return undefined;
    const term = query.trim();
    const excluded = excludeUuids.join(",").split(",").filter(Boolean);
    const id = ++requestRef.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const found = await searchProductsForPurchase(term);
        if (id !== requestRef.current) return;
        setOptions(found.filter((p) => !excluded.includes(p.uuid)));
        setHighlight(0);
      } catch {
        if (id === requestRef.current) setOptions([]);
      } finally {
        if (id === requestRef.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open, excludeUuids.join(",")]);

  useEffect(() => {
    if (!open) return undefined;
    const onClickAway = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [open]);

  const pick = (product) => {
    onChange(product);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (event) => {
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((n) => Math.min(n + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((n) => Math.max(n - 1, 0));
    } else if (event.key === "Enter" && options[highlight]) {
      event.preventDefault();
      pick(options[highlight]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="pp-picker" ref={boxRef}>
      {value ? (
        <div className="pp-picker-chip">
          <span>
            <strong>{value.name}</strong>
            <small>
              {value.sku}
              {value.stock !== undefined && ` · in stock ${value.stock}`}
            </small>
          </span>
          <button type="button" onClick={() => onChange(null)} aria-label="Change product">×</button>
        </div>
      ) : (
        <>
          <input
            type="text"
            value={query}
            placeholder={label || "Search products…"}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            aria-label={label || "Search products"}
            aria-expanded={open}
            role="combobox"
            aria-autocomplete="list"
          />
          {open && (
            <ul className="pp-picker-menu" role="listbox">
              {loading && <li className="pp-picker-empty">Searching…</li>}
              {!loading && options.length === 0 && (
                <li className="pp-picker-empty">No matching products</li>
              )}
              {!loading &&
                options.map((product, index) => (
                  <li key={product.uuid} role="option" aria-selected={index === highlight}>
                    <button
                      type="button"
                      className={index === highlight ? "pp-picker-option active" : "pp-picker-option"}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => pick(product)}
                    >
                      <span>
                        <strong>{product.name}</strong>
                        <small>{product.sku}</small>
                      </span>
                      <em>stock {product.stock}</em>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
