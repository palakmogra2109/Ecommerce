import { useMemo } from "react";

const DEFAULT_PAGE_OPTIONS = [10, 20, 50, 100];

function range(start, end) {
  const length = end - start + 1;
  return Array.from({ length }, (_, i) => start + i);
}

// Reusable Filament-style pagination controls.
//
// Props
//   pagination    object { page, limit, total, totalPages }
//   onPageChange  fn (page) => void
//   onLimitChange fn (limit) => void
//   pageSizeOptions array of numbers
export default function Pagination({
  pagination,
  onPageChange,
  onLimitChange,
  pageSizeOptions = DEFAULT_PAGE_OPTIONS,
}) {
  const { page, limit, total, totalPages } = pagination ?? {};

  const pageItems = useMemo(() => {
    if (!totalPages || totalPages <= 7) {
      return range(1, totalPages);
    }

    const pages = new Set([1, totalPages, page - 1, page, page + 1]);

    const sorted = [...pages]
      .filter((p) => p >= 1 && p <= totalPages)
      .sort((a, b) => a - b);

    const items = [];
    let prev = 0;

    for (const p of sorted) {
      if (p - prev > 1) {
        items.push("ellipsis");
      }
      items.push(p);
      prev = p;
    }

    return items;
  }, [page, totalPages]);

  if (!pagination || total === 0) {
    return null;
  }

  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  const button = (label, target, disabled, aria) => (
    <button
      type="button"
      className="filament-page-btn"
      disabled={disabled}
      aria-label={aria}
      onClick={() => onPageChange(target)}
    >
      {label}
    </button>
  );

  return (
    <div className="filament-pagination">
      <div className="filament-pagination-info">
        Showing <strong>{from}</strong>–<strong>{to}</strong> of{" "}
        <strong>{total}</strong>
      </div>

      <div className="filament-pagination-buttons">
        {button("‹", page - 1, page <= 1, "Previous page")}

        {pageItems.map((item, index) =>
          item === "ellipsis" ? (
            <span
              key={`ellipsis-${index}`}
              className="filament-page-ellipsis"
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={`filament-page-btn ${item === page ? "filament-page-btn-active" : ""}`}
              onClick={() => onPageChange(item)}
            >
              {item}
            </button>
          )
        )}

        {button("›", page + 1, page >= totalPages, "Next page")}
      </div>

      {onLimitChange && (
        <div className="filament-pagination-limit">
          <select
            className="filament-select filament-pagination-select"
            value={limit}
            onChange={(e) => onLimitChange(Number(e.target.value))}
            aria-label="Rows per page"
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option} / page
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
