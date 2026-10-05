import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

// Searchable dropdown, used for country, state and city.
//
// A native <select> was not enough for any of the three levels: 250 countries is
// a wall of text to scroll, and one Indian state holds thousands of cities. So
// this is a listbox with a search box on top, a keyboard model, and the open
// panel flipped above the field when there is no room below.
//
// Accessibility is real rather than decorative: role=combobox on the trigger,
// role=listbox on the panel, aria-activedescendant pointing at the highlighted
// option, and aria-expanded tracking the open state. The highlighted option is
// scrolled into view so keyboard and mouse agree on what is selected.

export default function SearchSelect({
  label,
  value,
  options = [],
  onChange,
  loading = false,
  placeholder = "Select…",
  emptyText = "No matches",
  disabled = false,
  hint,
  renderOption,
  renderValue,
  maxVisible = 12,
  id,
}) {
  const generatedId = useId();
  const listId = `${id || generatedId}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [flip, setFlip] = useState(false);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);

  // Filtering happens here rather than on the server for these three lists: the
  // largest is 250 rows, which is nothing, and it keeps typing instant.
  //
  // Ranked, not just filtered. A plain substring match put "British Indian Ocean
  // Territory" above "India" because it sorts first, so typing a country's name
  // and pressing Enter picked the wrong country. Exact match wins, then prefix,
  // then word-boundary, then any substring.
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options;

    const rank = (option) => {
      const label = String(option.label).toLowerCase();
      if (label === term) return 0;
      if (label.startsWith(term)) return 1;
      if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(label)) return 2;
      if (`${label} ${option.meta || ""}`.toLowerCase().includes(term)) return 3;
      return -1;
    };

    return options
      .map((option, index) => ({ option, index, rank: rank(option) }))
      .filter((entry) => entry.rank !== -1)
      .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
      .map((entry) => entry.option);
  }, [options, query]);

  useEffect(() => {
    if (!open) { setQuery(""); setActive(0); }
  }, [open]);

  // Flip the panel above the field when the viewport has no room below it.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setFlip(window.innerHeight - rect.bottom < 260 && rect.top > 260);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onAway = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onAway);
    return () => document.removeEventListener("mousedown", onAway);
  }, [open]);

  useEffect(() => {
    if (open && searchRef.current) searchRef.current.focus();
  }, [open]);

  // Keep the highlighted option in view as the arrow keys move through it.
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const option = panelRef.current.querySelector('[aria-selected="true"]');
    if (option) option.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const selected = options.find((option) => option.value === value) || null;
  const list = filtered;
  const chosenIndex = list.findIndex((option) => option.value === value);

  const commit = (option) => {
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (event) => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((n) => {
        const next = event.key === "ArrowDown" ? n + 1 : n - 1;
        if (next < 0) return Math.max(0, list.length - 1);
        if (next >= list.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Home" && open) { event.preventDefault(); setActive(0); return; }
    if (event.key === "End" && open) { event.preventDefault(); setActive(Math.max(0, list.length - 1)); return; }
    if (event.key === "Enter") {
      event.preventDefault();
      if (open) commit(list[active]);
      else setOpen(true);
      return;
    }
    if (event.key === "Escape") {
      if (open) { event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
      return;
    }
    if (event.key === "Tab" && open) setOpen(false);
    // Typing on the closed trigger opens the panel and starts a search, which is
    // what people expect from a combobox.
    //
    // preventDefault is required: the panel focuses the search box on open, and
    // without it the same keystroke was also inserted by the browser, so typing
    // one letter produced two ("Per" became "PPer").
    if (!open && event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      setQuery(event.key);
      setOpen(true);
    }
  };

  return (
    <div className={`ss${disabled ? " ss-disabled" : ""}`} ref={wrapRef}>
      <span className="ss-label">{label}</span>

      <button
        type="button"
        ref={triggerRef}
        id={id}
        className={`ss-trigger${selected ? " ss-has-value" : ""}${open ? " ss-open" : ""}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-activedescendant={open && list[active] ? `${listId}-${active}` : undefined}
        aria-label={label}
      >
        <span className="ss-value">
          {selected
            ? (renderValue ? renderValue(selected) : selected.label)
            : <span className="ss-placeholder">{loading ? "Loading…" : placeholder}</span>}
        </span>
        <span className="ss-caret" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z" /></svg>
        </span>
      </button>

      {open && (
        <div className={`ss-panel${flip ? " ss-panel-up" : ""}`}>
          <div className="ss-search">
            <svg viewBox="0 0 24 24" className="ss-search-icon" aria-hidden="true">
              <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z" />
            </svg>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              placeholder={`Search ${String(label).toLowerCase()}…`}
              aria-label={`Search ${label}`}
              aria-autocomplete="list"
            />
          </div>

          <ul className="ss-list" id={listId} role="listbox" ref={panelRef} aria-label={label}>
            {loading && <li className="ss-empty">Loading…</li>}
            {!loading && list.length === 0 && (
              <li className="ss-empty">
                {options.length === 0 ? emptyText : `No match for “${query.trim()}”`}
              </li>
            )}
            {!loading &&
              list.map((option, index) => {
                const isSelected = option.value === value;
                return (
                  <li
                    key={option.value}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={isSelected ? "true" : index === active ? "true" : "false"}
                    className={`ss-option${isSelected ? " ss-selected" : ""}${index === active ? " ss-active" : ""}`}
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commit(option)}
                  >
                    {renderOption ? renderOption(option) : (
                      <>
                        <span className="ss-option-label">{option.label}</span>
                        {option.meta && <span className="ss-option-meta">{option.meta}</span>}
                      </>
                    )}
                    {isSelected && (
                      <svg className="ss-check" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
                      </svg>
                    )}
                  </li>
                );
              })}
          </ul>

          {list.length > maxVisible && (
            <div className="ss-foot">
              {list.length} matches — keep typing to narrow
            </div>
          )}
        </div>
      )}

      {hint && <small className="frm-hint">{hint}</small>}
    </div>
  );
}
