import { useEffect, useMemo, useRef, useState } from "react";
import { listCountries } from "../services/countries";

// Reusable searchable phone input: searchable country dropdown (flag + code)
// + numeric national-number field. Emits the full E.164 value via onChange.
//
// Props
//   name         string   form field name (for errors)
//   value        string   current E.164 value (or undefined)
//   onChange     fn (e164) => void
//   error        string   validation error to display
//   placeholder  string
//   disabled     bool
//   defaultDialCode string country code preselected when the value carries
//     none (defaults to "+60" so existing admin usages are unchanged)
// National-number length that counts as valid (country code extra).
const MIN_NATIONAL_DIGITS = 10;
const MAX_NATIONAL_DIGITS = 12;

export default function PhoneInput({
  name = "mobile",
  value = "",
  onChange,
  error = "",
  placeholder = "12345678",
  disabled = false,
  defaultDialCode = "+60",
}) {
  const [countries, setCountries] = useState([]);
  const [dialCode, setDialCode] = useState(defaultDialCode);
  const [number, setNumber] = useState("");

  // Combobox state
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchText, setSearchText] = useState("");
  const rootRef = useRef(null);

  useEffect(() => {
    let active = true;

    listCountries()
      .then((result) => {
        if (active && result.success) {
          setCountries(result.countries || []);
        }
      })
      .catch(() => {
        // Fall back: the field still works without a populated list.
      });

    return () => {
      active = false;
    };
  }, []);

  // Match the longest known dial code that prefixes the given digits string.
  function matchDialCode(digits) {
    if (countries.length === 0) {
      return null;
    }

    const sorted = [...countries].sort(
      (a, b) => b.dialCode.length - a.dialCode.length
    );

    return (
      sorted.find((c) =>
        digits.startsWith(c.dialCode.replace("+", ""))
      ) || null
    );
  }

  // Split a stored E.164 number (+<dial><number>) into { dialCode, number }.
  function splitE164(input) {
    const str = String(input ?? "").trim();

    if (!str.startsWith("+")) {
      return { dialCode, number: str.replace(/\D/g, "") };
    }

    const digits = str.replace(/\D/g, "");
    const matched = matchDialCode(digits);

    if (!matched) {
      return { dialCode: defaultDialCode, number: digits };
    }

    return {
      dialCode: matched.dialCode,
      number: digits.slice(matched.dialCode.length - 1),
    };
  }

  const { dialCode: initDial, number: initNumber } = useMemo(
    () => splitE164(value),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, countries]
  );

  useEffect(() => {
    if (value !== undefined && value !== null && value !== "") {
      setDialCode(initDial);
      setNumber(initNumber);
    }
  }, [initDial, initNumber, value]);

  // Close the dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (open && rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);

    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Currently selected country (for the button label + flag)
  const selectedCountry = useMemo(
    () => countries.find((c) => c.dialCode === dialCode) || null,
    [countries, dialCode]
  );

  const filteredCountries = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q) {
      return countries;
    }

    return countries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.iso.toLowerCase().includes(q) ||
        c.dialCode.replace("+", "").startsWith(q.replace(/^\+/, ""))
    );
  }, [countries, query]);

  function emit(nextDial, nextNumber) {
    const digits = nextNumber.replace(/\D/g, "");
    const combined = digits ? `${nextDial}${digits}` : "";
    onChange(combined);
  }

  function handleSelect(country) {
    setDialCode(country.dialCode);
    setOpen(false);
    setQuery("");
    setSearchText("");
    emit(country.dialCode, number);
  }

  function handleNumberChange(next) {
    const digits = next.replace(/\D/g, "").slice(0, MAX_NATIONAL_DIGITS);
    setNumber(digits);
    emit(dialCode, digits);
  }

  // Green tick while the typed national number satisfies the length rule.
  const isValidLength =
    number.length >= MIN_NATIONAL_DIGITS && number.length <= MAX_NATIONAL_DIGITS;

  return (
    <div className="phone-input" ref={rootRef}>
      <div className="phone-input-controls">
        <div className="phone-code" data-open={open}>
          <button
            type="button"
            className="phone-code-trigger"
            onClick={() => {
              setOpen((v) => !v);
              setQuery("");
            }}
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <span className="phone-code-flag">
              {selectedCountry ? selectedCountry.flag : "🌐"}
            </span>
            <span className="phone-code-value">{dialCode}</span>
            <svg viewBox="0 0 24 24" className="phone-code-caret">
              <path d="M7 10l5 5 5-5z" />
            </svg>
          </button>

          {open && (
            <div className="phone-code-dropdown">
              <div className="phone-code-search">
                <svg viewBox="0 0 24 24" className="phone-code-search-icon">
                  <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search country..."
                  value={searchText}
                  onChange={(e) => {
                    setSearchText(e.target.value);
                    setQuery(e.target.value);
                  }}
                  autoFocus
                />
              </div>

              <ul className="phone-code-list" role="listbox">
                {filteredCountries.length === 0 ? (
                  <li className="phone-code-empty">No countries found</li>
                ) : (
                  filteredCountries.map((country) => (
                    <li
                      key={country.iso}
                      role="option"
                      aria-selected={country.dialCode === dialCode}
                      className={`phone-code-item ${country.dialCode === dialCode ? "phone-code-item-active" : ""}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelect(country);
                      }}
                    >
                      <span className="phone-code-item-flag">{country.flag}</span>
                      <span className="phone-code-item-name">{country.name}</span>
                      <span className="phone-code-item-code">{country.dialCode}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>

        <input
          type="tel"
          inputMode="numeric"
          name={name}
          placeholder={placeholder}
          value={number}
          onChange={(e) => handleNumberChange(e.target.value)}
          disabled={disabled}
          autoComplete="off"
          maxLength={MAX_NATIONAL_DIGITS}
        />
        {isValidLength && (
          <span className="phone-valid-badge" aria-label="Valid phone number" role="img">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
            </svg>
          </span>
        )}
      </div>

      {error && <p className="input-error">{error}</p>}

      <p className="phone-input-hint">
        Enter a 10 to 12 digit mobile number without the country code.
      </p>
    </div>
  );
}
