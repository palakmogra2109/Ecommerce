import { useEffect, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import Pagination from "../components/Pagination";
import {
  listReviews,
  moderateReview,
  deleteReview,
} from "../services/reviews";
import {
  REVIEW_STATUS,
  REVIEW_STATUS_LABELS,
  formatDateTime,
} from "@shared/constants";
import { useAuth } from "../context/AuthContext";

const RATING_OPTIONS = [5, 4, 3, 2, 1];

export default function Reviews() {
  const { can } = useAuth();
  const [reviews, setReviews] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [rating, setRating] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    setPage(1);
  }, [search, status, rating]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      setLoading(true);
      setMessage("");

      try {
        const data = await listReviews({
          search,
          status,
          rating,
          page,
          limit,
        });

        if (!active) {
          return;
        }

        if (data.success) {
          setReviews(data.reviews || []);
          setPagination(data.pagination || null);
        } else {
          setMessage(data.message);
        }
      } catch {
        if (!active) {
          return;
        }

        setMessage("Unable to connect to the server. Please try again.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      active = false;
    };
  }, [search, status, rating, page, limit]);

  async function act(fn) {
    setBusy(true);
    setMessage("");

    try {
      const data = await fn();

      if (!data.success) {
        setMessage(data.message);
      } else {
        setMessage(data.message);
        if (data.review?.uuid) {
          setExpanded(null);
        }
        // Refresh the current page after the action.
        setPage((p) => p);
        const refreshed = await listReviews({
          search,
          status,
          rating,
          page,
          limit,
        });

        if (refreshed.success) {
          setReviews(refreshed.reviews || []);
          setPagination(refreshed.pagination || null);
        }
      }
    } catch {
      setMessage("Unable to connect to the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function renderStars(value) {
    const stars = [];

    for (let i = 1; i <= 5; i += 1) {
      stars.push(
        <span
          key={i}
          className={`review-star${i <= value ? " review-star-on" : ""}`}
        >
          ★
        </span>
      );
    }

    return <span className="review-stars">{stars}</span>;
  }

  return (
    <div className="filament-page">
      <Breadcrumb items={[{ label: "Reviews" }]} />

      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <div className="filament-card-header">
          <div className="filament-card-header-left">
            <h1>Reviews</h1>
          </div>
        </div>

        <div className="filament-card-filters">
          <div className="filament-search">
            <svg className="filament-search-icon" viewBox="0 0 24 24">
              <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
            </svg>
            <input
              type="text"
              placeholder="Search by customer, title or comment"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="filament-select filter-select"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {Object.values(REVIEW_STATUS).map((value) => (
              <option key={value} value={value}>
                {REVIEW_STATUS_LABELS[value]}
              </option>
            ))}
          </select>

          <select
            className="filament-select filter-select"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            aria-label="Filter by rating"
          >
            <option value="">All ratings</option>
            {RATING_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value} star{value > 1 ? "s" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="filament-table-wrap">
          <table className="filament-table">
            <thead>
              <tr>
                <th>Review</th>
                <th>Product</th>
                <th>Customer</th>
                <th>Rating</th>
                <th>Date</th>
                <th>Status</th>
                <th className="filament-th-actions">Moderate</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" className="filament-empty">
                    <div className="filament-spinner" />
                  </td>
                </tr>
              ) : reviews.length === 0 ? (
                <tr>
                  <td colSpan="7" className="filament-empty">
                    No reviews found.
                  </td>
                </tr>
              ) : (
                reviews.map((review) => (
                  <tr key={review.uuid}>
                    <td>
                      <button
                        type="button"
                        className="review-toggle"
                        onClick={() =>
                          setExpanded((current) =>
                            current === review.uuid ? null : review.uuid
                          )
                        }
                      >
                        <strong>{review.title || "Untitled review"}</strong>
                        <span className="filament-muted">
                          {review.comment || "No comment"}
                        </span>
                      </button>
                      {expanded === review.uuid && (
                        <div className="review-detail">
                          <p>
                            {review.comment || "No comment text provided."}
                          </p>
                          {review.admin_response && (
                            <p className="review-admin-response">
                              <strong>Your response:</strong>{" "}
                              {review.admin_response}
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                    <td>{review.product_name || "—"}</td>
                    <td>{review.customer_name || "—"}</td>
                    <td>{renderStars(review.rating)}</td>
                    <td>{formatDateTime(review.created_at)}</td>
                    <td>
                      <span
                        className={`filament-badge filament-badge-${String(review.status || "").toLowerCase()}`}
                      >
                        <span className="filament-badge-dot" />
                        {REVIEW_STATUS_LABELS[review.status] || review.status}
                      </span>
                    </td>
                    <td>
                      <div className="review-actions">
                        {can("reviews.moderate") &&
                          review.status !== REVIEW_STATUS.APPROVED && (
                            <button
                              type="button"
                              className="filament-btn filament-btn-small"
                              disabled={busy}
                              onClick={() =>
                                act(() =>
                                  moderateReview(
                                    review.uuid,
                                    REVIEW_STATUS.APPROVED
                                  )
                                )
                              }
                            >
                              Approve
                            </button>
                          )}

                        {can("reviews.moderate") &&
                          review.status !== REVIEW_STATUS.REJECTED && (
                            <button
                              type="button"
                              className="filament-btn filament-btn-small"
                              disabled={busy}
                              onClick={() =>
                                act(() =>
                                  moderateReview(
                                    review.uuid,
                                    REVIEW_STATUS.REJECTED
                                  )
                                )
                              }
                            >
                              Reject
                            </button>
                          )}

                        {can("reviews.delete") && (
                          <button
                            type="button"
                            className="filament-action-btn filament-action-danger"
                            title="Delete review"
                            disabled={busy}
                            onClick={() =>
                              window.confirm(
                                "Delete this review permanently?"
                              ) &&
                              act(() => deleteReview(review.uuid))
                            }
                          >
                            <svg viewBox="0 0 24 24">
                              <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM8 9h8v10H8V9Zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5Z" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          pagination={pagination}
          onPageChange={(nextPage) => setPage(nextPage)}
          onLimitChange={(nextLimit) => {
            setLimit(nextLimit);
            setPage(1);
          }}
        />
      </div>
    </div>
  );
}